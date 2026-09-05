/**
 * Account.
 *
 * Deliberately NOT a settings dump. Amazon's account area is a large grid
 * of tiles, which works when you have fifty capabilities and is actively
 * worse when you have five — the customer scans a grid to find the one
 * thing they came for. Craavee has five, so this is a short list where
 * every row is a real destination.
 *
 * The section that earns its place most is the **wallet**. Craavee's
 * refunds are wallet-only by decision (D38), which means until now a
 * refunded customer got their money back and had **no way to see it**.
 * The credit existed; the evidence did not. Showing the balance and the
 * recent movements turns an invisible policy into something the customer
 * can verify — which is the whole of trust in a refund.
 *
 * Nothing here is invented. Every row reads a column that exists:
 * `profiles.phone`, `profiles.full_name`, `profiles.wallet_balance`,
 * `wallet_ledger`. There is no notification-preferences row because there
 * is no preferences column, and no support row because there is no
 * support backend — both are recorded as backend gaps rather than shown
 * as controls that do nothing.
 */
import { Link, useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";

import { ErrorState, Screen, Skeleton } from "../../../components/ui";
import { useAuth } from "../../../lib/auth/AuthProvider";
import { rupees } from "../../../lib/format";
import { haptic } from "../../../lib/haptics";
import { useProfile } from "../../../hooks/useProfile";
import {
  useWalletBalance,
  useWalletLedger,
  walletReasonLabel,
  type WalletEntry,
} from "../../../hooks/useWallet";

export default function AccountScreen() {
  const router = useRouter();
  const { signOut } = useAuth();
  const profile = useProfile();
  const balance = useWalletBalance();
  const ledger = useWalletLedger();

  return (
    <Screen padded={false} edges={["top"]}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 96 }}>
        <Text accessibilityRole="header" className="text-2xl font-bold text-brand-deep">
          Account
        </Text>

        {/* Identity. The phone number is the account - it is what signs
            you in - so it is shown as the primary line rather than buried
            in a profile sub-screen. */}
        <View className="mt-4 rounded-2xl border border-inkdeep/10 bg-white p-4">
          {profile.isPending ? (
            <View className="gap-2">
              <Skeleton height={20} width="50%" />
              <Skeleton height={14} width="35%" />
            </View>
          ) : (
            <>
              <Text className="text-lg font-bold text-inkdeep">
                {profile.data?.full_name?.trim() || "Craavee customer"}
              </Text>
              <Text className="mt-0.5 text-sm text-inkdeep/60">
                {profile.data?.phone ?? ""}
              </Text>
            </>
          )}
        </View>

        {/* Wallet */}
        <Text
          accessibilityRole="header"
          className="mb-2 mt-6 text-xs font-bold uppercase tracking-wider text-inkdeep/45"
        >
          Wallet
        </Text>

        <View className="rounded-2xl border border-inkdeep/10 bg-white p-4">
          {balance.isPending ? (
            <Skeleton height={30} width="40%" />
          ) : balance.isError ? (
            <ErrorState
              title="Couldn't load your wallet"
              detail="Check your connection and try again."
              onRetry={() => balance.refetch()}
            />
          ) : (
            <>
              <Text className="text-xs text-inkdeep/50">Balance</Text>
              <Text className="mt-0.5 text-3xl font-bold text-brand-deep" testID="wallet-balance">
                {rupees(balance.data ?? 0)}
              </Text>
              <Text className="mt-2 text-xs leading-4 text-inkdeep/50">
                Refunds are credited here and applied automatically at checkout.
              </Text>
            </>
          )}
        </View>

        {/* Ledger. Present only when there is something to show - an empty
            "Recent activity" heading over nothing is noise on a new
            account. */}
        {!ledger.isPending && (ledger.data?.length ?? 0) > 0 ? (
          <>
            <Text
              accessibilityRole="header"
              className="mb-2 mt-6 text-xs font-bold uppercase tracking-wider text-inkdeep/45"
            >
              Recent wallet activity
            </Text>
            <View className="rounded-2xl border border-inkdeep/10 bg-white px-4">
              {ledger.data!.map((entry, i) => (
                <LedgerRow key={entry.id} entry={entry} last={i === ledger.data!.length - 1} />
              ))}
            </View>
          </>
        ) : null}

        {/* Destinations */}
        <Text
          accessibilityRole="header"
          className="mb-2 mt-6 text-xs font-bold uppercase tracking-wider text-inkdeep/45"
        >
          Manage
        </Text>
        <View className="overflow-hidden rounded-2xl border border-inkdeep/10 bg-white">
          <Row label="Your orders" hint="Track and review past orders" href="/orders" testID="account-orders" />
          <Row label="Add an address" hint="Where we deliver" href="/address/new" testID="account-address" last />
        </View>

        {/* Deliberately absent, and why - see the header comment:
            notification preferences (no column), support (no backend).
            A row that opens nothing is worse than no row. */}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sign out"
          onPress={() => {
            // A committed, mildly destructive action the customer should
            // feel land.
            haptic("warning");
            signOut();
          }}
          testID="account-signout"
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          className="mt-6 min-h-[52px] items-center justify-center rounded-2xl border border-inkdeep/15"
        >
          <Text className="text-sm font-semibold text-mango">Sign out</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

function LedgerRow({ entry, last }: { entry: WalletEntry; last: boolean }) {
  const credit = entry.delta > 0;
  const label = walletReasonLabel(entry.reason);
  const amount = `${credit ? "+" : "−"}${rupees(Math.abs(entry.delta))}`;

  let when = "";
  try {
    when = new Date(entry.createdAt).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
    });
  } catch {
    when = "";
  }

  return (
    <View
      className={`flex-row items-center justify-between py-3 ${last ? "" : "border-b border-inkdeep/5"}`}
      // One label, so a screen reader does not read three disconnected
      // fragments. The sign is spoken as a word, not left to a glyph.
      accessibilityLabel={`${label}, ${credit ? "credit" : "debit"} of ${rupees(
        Math.abs(entry.delta),
      )}${when ? `, ${when}` : ""}`}
    >
      <View className="flex-1 pr-3">
        <Text className="text-sm font-medium text-inkdeep">{label}</Text>
        {when ? <Text className="mt-0.5 text-xs text-inkdeep/45">{when}</Text> : null}
      </View>
      {/* Direction is carried by the sign as well as the colour, so it
          survives a colour-blind reading. */}
      <Text
        className={`shrink-0 pr-1 text-sm font-bold ${credit ? "text-brand" : "text-inkdeep/70"}`}
      >
        {amount}
      </Text>
    </View>
  );
}

function Row({
  label,
  hint,
  href,
  testID,
  last,
}: {
  label: string;
  hint: string;
  href: string;
  testID: string;
  last?: boolean;
}) {
  return (
    <Link href={href} asChild>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={hint}
        testID={testID}
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        className={`min-h-[56px] flex-row items-center justify-between px-4 ${
          last ? "" : "border-b border-inkdeep/5"
        }`}
      >
        <View className="flex-1 pr-3">
          <Text className="text-[15px] font-medium text-inkdeep">{label}</Text>
          <Text className="mt-0.5 text-xs text-inkdeep/45">{hint}</Text>
        </View>
        <Text className="shrink-0 text-base text-inkdeep/30">›</Text>
      </Pressable>
    </Link>
  );
}
