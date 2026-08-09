import { createContext, useContext, useState, useEffect, ReactNode, useMemo, useCallback } from 'react';

// Inline shop-scoped key resolver — avoids importing shopStorage here so
// editing AuthContext doesn't pull in a churning import graph and break HMR.
function shopScopedKey(key: string): string {
  const activeShopId = localStorage.getItem('activeShopId');
  if (!activeShopId) return key; // pre-auth state - no scoping
  return `${activeShopId}__${key}`;
}

interface User {
  id: number;
  name: string;
  nameEn: string;
  phone: string;
  shopName: string;
  shopNameEn: string;
  role: 'owner' | 'staff';
  pin: string;
  createdAt: string;
}

interface StaffMember {
  id: number;
  name: string;
  nameEn: string;
  phone: string;
  role: string;
  roleBn: string;
  pin: string;
  active: boolean;
  permissions: {
    // --- SALES ---
    sale_entry: boolean;        // Can process new sales (POS screen)
    sale_discount: boolean;     // Can apply discounts during checkout
    sale_return: boolean;       // Can process returns/refunds
    sale_history: boolean;      // Can view sales history list

    // --- INVENTORY ---
    inventory_view: boolean;    // Can view stock levels
    inventory_edit: boolean;    // Can add stock, update batches
    expiry_manage: boolean;     // Can mark batches discounted/returned

    // --- CREDIT & CASH ---
    credit_view: boolean;       // Can view credit customer list
    credit_manage: boolean;     // Can record credit sales and payments
    cash_drawer: boolean;       // Can view cash drawer / end-of-day

    // --- MANAGEMENT ---
    reports: boolean;           // Can view reports, monthly P&L, store overview
    staff_manage: boolean;      // Can view/add/edit staff (Manager only)
  };
  createdAt: string;
  lastLogin?: string;
}

interface AuthContextType {
  user: User | null;
  staff: StaffMember | null;
  isAuthenticated: boolean;
  isOwner: boolean;
  login: (phone: string, pin: string) => Promise<boolean>;
  staffLogin: (phone: string, pin: string) => Promise<boolean>;
  logout: () => void;
  register: (data: { shopName: string; shopNameEn: string; name: string; nameEn: string; phone: string; pin: string }) => Promise<boolean>;
  updateUser: (data: Partial<User>) => void;
  changePin: (currentPin: string, newPin: string) => Promise<{ success: boolean; error?: string }>;
  hasPermission: (permission: keyof StaffMember['permissions']) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [staff, setStaff] = useState<StaffMember | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Load auth state from localStorage on mount
  useEffect(() => {
    const storedUser = localStorage.getItem('currentUser');
    const storedStaff = localStorage.getItem('currentStaff');
    const authType = localStorage.getItem('authType');

    if (authType === 'owner' && storedUser) {
      const parsedUser = JSON.parse(storedUser);
      setUser(parsedUser);
      setIsAuthenticated(true);

      // Migration: backfill ownerId on existing shops (pre-isolation fix)
      try {
        const shops = JSON.parse(localStorage.getItem('shopRegistry') || '[]');
        let updated = false;
        const migratedShops = shops.map((shop: any) => {
          if (!shop.ownerId) {
            updated = true;
            return { ...shop, ownerId: parsedUser.id };
          }
          return shop;
        });
        if (updated) {
          localStorage.setItem('shopRegistry', JSON.stringify(migratedShops));
        }
      } catch {}
    } else if (authType === 'staff' && storedStaff) {
      const parsedStaff = JSON.parse(storedStaff);
      setStaff(parsedStaff);
      setIsAuthenticated(true);
    }
  }, []);

  const register = useCallback(async (data: {
    shopName: string;
    shopNameEn: string;
    name: string;
    nameEn: string;
    phone: string;
    pin: string;
  }): Promise<boolean> => {
    try {
      // Check if user already exists
      const users = JSON.parse(localStorage.getItem('users') || '[]');
      const existingUser = users.find((u: User) => u.phone === data.phone);
      
      if (existingUser) {
        return false;
      }

      // Create new user
      const newUser: User = {
        id: Date.now(),
        name: data.name,
        nameEn: data.nameEn,
        phone: data.phone,
        shopName: data.shopName,
        shopNameEn: data.shopNameEn,
        role: 'owner',
        pin: data.pin,
        createdAt: new Date().toISOString(),
      };

      // Save to localStorage
      users.push(newUser);
      localStorage.setItem('users', JSON.stringify(users));

      // Persist pharmacy registration so migrations and Settings screen can read it
      localStorage.setItem('pharmacyRegistration', JSON.stringify({
        pharmacyName: data.shopName,
        pharmacyNameEn: data.shopNameEn,
        ownerName: data.name,
        phoneNumber: data.phone,
      }));

      // Create a unique shop for this owner (always, even if previous owners exist)
      const newShopId = `shop_${newUser.id}`;
      const firstShop = {
        id: newShopId,
        ownerId: newUser.id,
        name: data.shopName,
        nameEn: data.shopNameEn || data.shopName,
        createdAt: new Date().toISOString(),
        isActive: true,
      };

      // Each owner gets their own shop registry entry
      const existingRegistry = JSON.parse(localStorage.getItem('shopRegistry') || '[]');
      existingRegistry.push(firstShop);
      localStorage.setItem('shopRegistry', JSON.stringify(existingRegistry));
      localStorage.setItem('activeShopId', newShopId);

      // Auto-login after registration
      setUser(newUser);
      setIsAuthenticated(true);
      localStorage.setItem('currentUser', JSON.stringify(newUser));
      localStorage.setItem('authType', 'owner');

      return true;
    } catch (error) {
      console.error('Registration error:', error);
      return false;
    }
  }, []);

  const login = useCallback(async (phone: string, pin: string): Promise<boolean> => {
    try {
      const users = JSON.parse(localStorage.getItem('users') || '[]');
      const foundUser = users.find((u: User) => u.phone === phone && u.pin === pin);

      if (foundUser) {
        // Switch to this owner's shop (isolate from other owners on same device)
        const shops = JSON.parse(localStorage.getItem('shopRegistry') || '[]');
        const myShops = shops.filter((s: any) => s.ownerId === foundUser.id);

        if (myShops.length > 0) {
          // Set to their active shop, or first shop if none marked active
          const activeShop = myShops.find((s: any) => s.isActive) || myShops[0];
          localStorage.setItem('activeShopId', activeShop.id);
        }

        setUser(foundUser);
        setIsAuthenticated(true);
        localStorage.setItem('currentUser', JSON.stringify(foundUser));
        localStorage.setItem('authType', 'owner');
        return true;
      }

      return false;
    } catch (error) {
      console.error('Login error:', error);
      return false;
    }
  }, []);

  const staffLogin = useCallback(async (phone: string, pin: string): Promise<boolean> => {
    try {
      const staffMembers = JSON.parse(localStorage.getItem(shopScopedKey('staffMembers')) || '[]');
      const foundStaff = staffMembers.find((s: StaffMember) => s.phone === phone && s.pin === pin);

      if (foundStaff) {
        // Check if staff account is active
        if (!foundStaff.active) {
          // Staff exists but is deactivated
          return false;
        }

        // Update last login
        foundStaff.lastLogin = new Date().toISOString();
        const updatedStaff = staffMembers.map((s: StaffMember) => 
          s.id === foundStaff.id ? foundStaff : s
        );
        localStorage.setItem(shopScopedKey('staffMembers'), JSON.stringify(updatedStaff));

        setStaff(foundStaff);
        setIsAuthenticated(true);
        localStorage.setItem('currentStaff', JSON.stringify(foundStaff));
        localStorage.setItem('authType', 'staff');
        return true;
      }

      return false;
    } catch (error) {
      console.error('Staff login error:', error);
      return false;
    }
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    setStaff(null);
    setIsAuthenticated(false);
    localStorage.removeItem('currentUser');
    localStorage.removeItem('currentStaff');
    localStorage.removeItem('authType');
  }, []);

  const updateUser = useCallback((data: Partial<User>) => {
    if (!user) return;

    const updatedUser = { ...user, ...data };
    setUser(updatedUser);

    // Update in localStorage
    const users = JSON.parse(localStorage.getItem('users') || '[]');
    const updatedUsers = users.map((u: User) =>
      u.id === user.id ? updatedUser : u
    );
    localStorage.setItem('users', JSON.stringify(updatedUsers));
    localStorage.setItem('currentUser', JSON.stringify(updatedUser));
  }, [user]);

  const changePin = useCallback(async (currentPin: string, newPin: string): Promise<{ success: boolean; error?: string }> => {
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    // Verify current PIN
    if (user.pin !== currentPin) {
      return { success: false, error: 'current_pin_incorrect' };
    }

    // Validate new PIN format (4 digits)
    if (!/^\d{4}$/.test(newPin)) {
      return { success: false, error: 'invalid_pin_format' };
    }

    // Update user's PIN
    const updatedUser = { ...user, pin: newPin };
    setUser(updatedUser);

    // Update in localStorage
    const users = JSON.parse(localStorage.getItem('users') || '[]');
    const updatedUsers = users.map((u: User) =>
      u.id === user.id ? updatedUser : u
    );
    localStorage.setItem('users', JSON.stringify(updatedUsers));
    localStorage.setItem('currentUser', JSON.stringify(updatedUser));

    return { success: true };
  }, [user]);

  const isOwner = useMemo(() => user?.role === 'owner', [user?.role]);

  const hasPermission = useCallback((permission: keyof StaffMember['permissions']): boolean => {
    if (user?.role === 'owner') return true;
    if (!staff) return false;
    return staff.permissions[permission] || false;
  }, [user?.role, staff]);

  const value = useMemo(() => ({
    user,
    staff,
    isAuthenticated,
    isOwner,
    login,
    staffLogin,
    logout,
    register,
    updateUser,
    changePin,
    hasPermission,
  }), [user, staff, isAuthenticated, isOwner, login, staffLogin, logout, register, updateUser, changePin, hasPermission]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    // Return a safe fallback for environments without AuthProvider (e.g., Figma preview)
    console.warn("useAuth called outside AuthProvider - using fallback");
    return {
      user: null,
      staff: null,
      isAuthenticated: false,
      isOwner: false,
      login: async () => false,
      loginStaff: async () => false,
      logout: () => {},
      register: async () => false,
      hasPermission: () => false,
    };
  }
  return context;
}