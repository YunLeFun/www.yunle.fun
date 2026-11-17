export type CookHandoffReply
  = { state: 'pending' }
    | { state: 'switch', confirmation: string }
    | { state: 'reuse', subject: string }
    | { state: 'issued', subject: string, ticket: string }
