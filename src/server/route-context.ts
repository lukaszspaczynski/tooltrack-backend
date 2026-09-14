// The shape of a route handler.
//
// It lives here rather than in index.ts because importing index.ts starts a
// server and opens a pool, and every route module needs this type.

import type { User } from '../access/roles'

export type RouteContext = {
  // Where the request came from, as far as the network can say — the socket,
  // or what a trusted proxy reported. Only the login throttle reads it, and it
  // is here rather than ambient because exactly one route needs it and a value
  // a handler can forget to pass is better than one it can forget exists.
  clientAddress: string
  params: Record<string, string>
  // The account behind the request's cookie, already resolved by the guard.
  // Routes classified `allow` in the route policy can see null here; the rest
  // cannot be reached without an active user, so they read it directly.
  user: null | User
}

export type RouteHandler = (request: Request, context: RouteContext) => Promise<Response> | Response
