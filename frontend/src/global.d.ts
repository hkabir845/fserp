export {}

declare global {
  interface Window {
    /** Set by inline extension-noise filter in root layout. */
    __fserpExtNoiseFilter?: 1
  }
}
