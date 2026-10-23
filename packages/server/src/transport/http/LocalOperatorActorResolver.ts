import type { Actor } from "../../shared/application/Actor.js";
import type { ActorResolver } from "./ActorResolver.js";

/** Only for the loopback, single-operator deployment. */
export class LocalOperatorActorResolver implements ActorResolver {
  resolve(): Actor {
    return { id: "local-operator" };
  }
}
