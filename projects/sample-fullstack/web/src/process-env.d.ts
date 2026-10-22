declare namespace NodeJS {
  interface ProcessEnv {
    /** Set by Next.js. */
    readonly NEXT_RUNTIME?: 'nodejs' | 'edge';
  }
}
