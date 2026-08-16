export interface RuntimeIdentity {
  uid: string
}

export interface AuthVerifier {
  verifyAccessToken: (accessToken: string) => Promise<RuntimeIdentity>
}
