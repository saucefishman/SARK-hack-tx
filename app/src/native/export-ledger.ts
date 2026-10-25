import { Platform, Share } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import type { FriendSummary } from "@sark/shared";
export async function exportLedger(friends: FriendSummary[]) {
  const cell = (value: string | number) =>
    '"' +
    String(
      typeof value === "string" && /^[=+@-]/.test(value) ? "'" + value : value,
    ).replace(/"/g, '""') +
    '"';
  const csv = [
    [
      "Name",
      "Shared moments",
      "You spent (USD)",
      "Spent on you (USD)",
      "Balance (USD)",
    ],
    ...friends.map((f) => [
      f.name,
      f.eventCount,
      f.youSpentOnThemCents / 100,
      f.spentOnYouCents / 100,
      f.balanceCents / 100,
    ]),
  ]
    .map((row) => row.map(cell).join(","))
    .join("\r\n");
  if (Platform.OS === "web") {
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "friend-balances.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  if (FileSystem.cacheDirectory && (await Sharing.isAvailableAsync())) {
    const uri = FileSystem.cacheDirectory + "friend-balances.csv";
    await FileSystem.writeAsStringAsync(uri, csv);
    await Sharing.shareAsync(uri, {
      mimeType: "text/csv",
      UTI: "public.comma-separated-values-text",
      dialogTitle: "Export friend balances",
    });
  } else await Share.share({ message: csv, title: "Friend balances" });
}
