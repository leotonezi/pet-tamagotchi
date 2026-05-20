/**
 * Compatibility shim for wallet-adapter packages that were published against
 * @types/react v17 (where `ReactNode` did not include `bigint`).
 *
 * React 18 expanded `ReactNode` to include `bigint`, which breaks the `FC`
 * return type used by those libraries. Re-opening the `React` namespace to
 * patch the narrower `FunctionComponent` signature makes TSC happy without
 * requiring skipLibCheck or a version downgrade.
 */
import "react";

declare module "react" {
  // Ensure `FC` / `FunctionComponent` returns are compatible with React 18 JSX.
  interface FunctionComponent<P = Record<string, unknown>> {
    (props: P, context?: unknown): React.ReactNode;
  }
}
