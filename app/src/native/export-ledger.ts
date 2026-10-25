import { Platform, Share } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import type { FriendSummary } from "@sark/shared";
import { ledgerCsv } from "./ledger-presentation";
export async function exportLedger(friends: FriendSummary[]) {
  const csv = ledgerCsv(friends);
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
