import type { Request } from "express";
import type { ParamsFlatDictionary } from "express-serve-static-core";

/**
 * Route parameters, as flat strings.
 *
 * Express 5 types `req.params` as `ParamsDictionary`, whose values are
 * `string | string[]`, because its router supports repeatable parameters
 * (`/:id+`, `/:id*`) that capture more than one path segment. This service
 * defines no such route — every pattern here is a simple `:name` — so the
 * array arm is unreachable, and without this it produces ~160 compile errors
 * at call sites that pass a parameter straight into a `string` position.
 *
 * `ParamsFlatDictionary` is the narrow form Express itself exports, and the
 * one its own types infer when a route is given as a literal string.
 *
 * This is an assertion about this repository's routes, not about Express. If a
 * repeatable parameter is ever added, its handler must read `req.params`
 * directly instead, where the compiler will insist the array case is handled.
 */
export function routeParams(req: Request): ParamsFlatDictionary {
  return req.params as ParamsFlatDictionary;
}
