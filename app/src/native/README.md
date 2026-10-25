# Finance UI

Overview, Review, shared-activity details, and modal sheets use React Native components. The Expo Router `.tsx` and `.web.tsx` routes both render these screens; the browser version uses React Native Web.

- Existing API hooks supply integer-cent balances and review actions.
- Shared balance is the amount owed to the user minus the amount the user owes.
- The balance header stays fixed while the friends section scrolls.
- Native selectors and sheets animate with reduced-motion support. A review card exits only after its save succeeds, before query refresh removes it.
- Export downloads CSV on web and uses native file sharing on Android/iOS.
- Poppins, Inter, and PNG avatars are bundled locally. Artwork/font licenses are in `app/assets/`.

From the repository root:

```sh
pnpm install
pnpm --filter app typecheck
pnpm --filter app exec expo start --lan
```

The existing API must be reachable from the phone. `EXPO_PUBLIC_API_URL` can override the default development host on port 3000. `EXPO_PUBLIC_USE_MOCKS=1` selects the existing local mock adapter for UI-only testing.

Validation: app typecheck and Android/iOS/web bundle exports. Physical-device visual and native-sharing checks remain necessary.
