import type { ConfigContext, ExpoConfig } from 'expo/config';

// Each build profile (eas.json sets APP_VARIANT) gets its own package, so the
// production app, the preview app and the development build install side by
// side and never replace one another.
const VARIANTS: Record<string, { suffix: string; label: string }> = {
  development: { suffix: '.dev', label: ' (dev)' },
  preview: { suffix: '.preview', label: ' (preview)' },
};
const variant = VARIANTS[process.env.APP_VARIANT ?? ''];

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: `${config.name!}${variant?.label ?? ''}`,
  slug: config.slug!,
  android: { ...config.android, package: `${config.android!.package!}${variant?.suffix ?? ''}` },
  ios: { ...config.ios, bundleIdentifier: `${config.ios!.bundleIdentifier!}${variant?.suffix ?? ''}` },
});
