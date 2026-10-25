import { Action, Details, Sheet } from "./kit";
import { Loading } from '../components/ui';
import { Text, View } from 'react-native';
import { nativeStyles } from './kit';
import { formatCents } from "../format";
export function AccountSheet({
  visible,
  onClose,
  owed,
  owe,
  available = true,
  failed = false,
  onRetry,
}: {
  visible: boolean;
  onClose: () => void;
  owed: number;
  owe: number;
  available?: boolean;
  failed?: boolean;
  onRetry?: () => void;
}) {
  return (
    <Sheet visible={visible} onClose={onClose} label="Your account">
      {!available ? failed ? <View style={{gap:16,paddingVertical:15}}><Text style={nativeStyles.title}>Balances unavailable</Text><Text style={nativeStyles.caption}>Couldn't load your account balances. Try again.</Text><Action title="Try again" onPress={()=>onRetry?.()}/></View> : <Loading label="Loading balances…"/> : <Details
        name="Your account"
        caption="Shared balance"
        balance={owed - owe}
        rows={[
          ["You're owed", formatCents(owed)],
          ["You owe", formatCents(owe)],
          ["Currency", "USD"],
        ]}
        onClose={onClose}
      />}
    </Sheet>
  );
}
