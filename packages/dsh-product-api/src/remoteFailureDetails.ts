import type { EleckoiFailureDetailsMap } from '@eleckoi/product-shared/contracts/errors/details'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap extends EleckoiFailureDetailsMap {}
}
