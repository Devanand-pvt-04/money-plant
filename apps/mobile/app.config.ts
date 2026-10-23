import type { ConfigContext, ExpoConfig } from 'expo/config';

// Preview builds (eas.json sets APP_VARIANT) get their own package, so they
// install next to the development build instead of replacing it.
const preview = process.env.APP_VARIANT === 'preview';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: preview ? 'Money Plant (preview)' : config.name!,
  slug: config.slug!,
  android: { ...config.android, package: preview ? 'in.moneyplant.app.preview' : config.android?.package },
  ios: { ...config.ios, bundleIdentifier: preview ? 'in.moneyplant.app.preview' : config.ios?.bundleIdentifier },
});
