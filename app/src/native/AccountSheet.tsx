import { Details, Sheet } from "./kit";
import { formatCents } from "../format";
export function AccountSheet({
  visible,
  onClose,
  owed,
  owe,
}: {
  visible: boolean;
  onClose: () => void;
  owed: number;
  owe: number;
}) {
  return (
    <Sheet visible={visible} onClose={onClose} label="Your account">
      <Details
        name="Your account"
        caption="Shared balance"
        balance={owed - owe}
        rows={[
          ["You're owed", formatCents(owed)],
          ["You owe", formatCents(owe)],
          ["Currency", "USD"],
        ]}
        onClose={onClose}
      />
    </Sheet>
  );
}
