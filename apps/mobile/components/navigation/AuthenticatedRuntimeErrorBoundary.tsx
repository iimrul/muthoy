import { Component, type ErrorInfo, type ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { usePathname } from "expo-router";
import {
  getRuntimeDiagnosticSnapshot,
  isRuntimeDiagnosticsEnabled,
  runtimeDiagnosticError,
  sessionDiagnosticContext,
  type RuntimeDiagnosticContext,
  type RuntimeDiagnosticSnapshot,
} from "../../dev/runtimeDiagnostics";
import { useSessionStore } from "../../state/sessionStore";

interface BoundaryProps {
  children?: ReactNode;
  context: RuntimeDiagnosticContext;
}

interface BoundaryState {
  error: Error | null;
  snapshot: RuntimeDiagnosticSnapshot | null;
}

export class DevRuntimeErrorBoundary extends Component<
  BoundaryProps,
  BoundaryState
> {
  state: BoundaryState = { error: null, snapshot: null };

  static getDerivedStateFromError(error: Error): Partial<BoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({
      snapshot: runtimeDiagnosticError(
        error,
        this.props.context,
        info.componentStack ?? undefined,
      ),
    });
  }

  render() {
    if (!this.state.error) return this.props.children;

    const snapshot =
      this.state.snapshot ?? getRuntimeDiagnosticSnapshot(this.props.context);
    const stack = snapshot.stack ?? this.state.error.stack;

    return (
      <ScrollView
        accessibilityRole="alert"
        className="flex-1 bg-errorBg"
        contentContainerClassName="gap-3 p-5"
      >
        <Text className="font-sans-bold text-lg text-error">
          DEV Runtime Diagnostic
        </Text>
        <DiagnosticRow label="Error" value={this.state.error.message} />
        <DiagnosticRow label="Current route" value={snapshot.currentRoute} />
        <DiagnosticRow label="User id" value={snapshot.userId} />
        <DiagnosticRow label="Shop id" value={snapshot.shopId} />
        <DiagnosticRow label="Resolved role" value={snapshot.resolvedRole} />
        <DiagnosticRow
          label="Permission count"
          value={String(snapshot.permissionCount)}
        />
        <DiagnosticRow
          label="Last completed diagnostic step"
          value={snapshot.lastCompletedStep}
        />
        {stack ? <DiagnosticRow label="Stack" value={stack} /> : null}
      </ScrollView>
    );
  }
}

function DiagnosticRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="gap-1 rounded-lg bg-white p-3">
      <Text className="font-sans-semibold text-xs text-midGray">{label}</Text>
      <Text selectable className="font-mono text-xs text-richBlack">
        {value}
      </Text>
    </View>
  );
}

export function AuthenticatedRuntimeErrorBoundary({
  children,
}: {
  children?: ReactNode;
}) {
  const pathname = usePathname();
  const session = useSessionStore((state) => state.session);

  if (!isRuntimeDiagnosticsEnabled()) return <>{children}</>;

  return (
    <DevRuntimeErrorBoundary
      context={sessionDiagnosticContext(session, pathname)}
    >
      {children}
    </DevRuntimeErrorBoundary>
  );
}
