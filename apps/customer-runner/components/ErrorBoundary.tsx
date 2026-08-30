import { Component, type ReactNode } from "react";
import { View, Text } from "react-native";

/**
 * Basic crash boundary for the app root.
 *
 * React error boundaries must be class components (there is no Hooks
 * equivalent of `componentDidCatch`/`getDerivedStateFromError` as of
 * React 19). This is intentionally minimal: no retry/reset affordance, no
 * crash reporting wiring. Both are product decisions for a later phase.
 */
interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <View className="flex-1 items-center justify-center bg-paper px-6">
          <Text className="text-center text-base font-semibold text-inkdeep">
            Something went wrong.
          </Text>
          <Text className="mt-2 text-center text-sm text-inkdeep/70">
            {this.state.error.message}
          </Text>
        </View>
      );
    }

    return this.props.children;
  }
}
