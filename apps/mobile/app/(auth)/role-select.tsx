import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';

// Role Select — the entry point for a device that holds no shop yet.
//
// Three doors, and the distinction that matters is the FIRST one: registering
// creates a new pharmacy, the other two join one that already exists. Before
// this screen, "no local data" could only mean "register", which silently
// assumed one device per shop forever.
//
// Owner and Staff both lead to the same phone + PIN screen and the same
// endpoint — the role is resolved from the account, never from what was tapped
// here. The split exists because the two arrive with different expectations (an
// owner has a shop phone and a recovery path; a staff member has a number their
// owner issued them and does not), and because a wrong tap should read as a
// wrong door rather than as a broken login.
export default function RoleSelectScreen() {
  return (
    <View className="flex-1 justify-center gap-8 bg-brand-softGreen p-6">
      <View className="gap-1">
        <Text className="font-sans-bold text-2xl text-richBlack">Welcome to Muthoy</Text>
        <Text className="font-sans text-sm text-midGray">How would you like to continue?</Text>
      </View>

      <View className="gap-3">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Register a new shop"
          onPress={() => router.push('/register')}
          className="gap-1 rounded-lg bg-brand-green p-4 active:opacity-80"
        >
          <Text className="font-sans-semibold text-base text-white">Register a new shop</Text>
          <Text className="font-sans text-xs text-white/80">
            First time here. Verifies your phone by SMS.
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Owner login"
          onPress={() => router.push({ pathname: '/device-login', params: { role: 'owner' } })}
          className="gap-1 rounded-lg bg-white p-4 active:opacity-80"
        >
          <Text className="font-sans-semibold text-base text-richBlack">I am the owner</Text>
          <Text className="font-sans text-xs text-midGray">
            Your shop already exists. Phone number and PIN, no code needed.
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Staff login"
          onPress={() => router.push({ pathname: '/device-login', params: { role: 'staff' } })}
          className="gap-1 rounded-lg bg-white p-4 active:opacity-80"
        >
          <Text className="font-sans-semibold text-base text-richBlack">I am staff</Text>
          <Text className="font-sans text-xs text-midGray">
            Use the phone number and PIN your shop owner gave you.
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
