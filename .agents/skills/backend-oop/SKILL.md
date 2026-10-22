---
name: backend-oop
description: Implement, refactor, or review Kushex backend code in packages/server using a strongly object-oriented TypeScript design. Apply to backend startup, HTTP handling, business logic, integrations, and persistence; exclude frontend-only work.
---

# Kushex backend OOP

Use a strongly object-oriented design for backend code in `packages/server`.

## Object ownership

- Implement application behavior in cohesive classes with clear ownership of state,
  dependencies, lifecycle, and invariants. Avoid procedural modules of exported handlers
  and functions for backend workflows.
- Keep `src/index.ts` as a thin composition root: load configuration, construct and wire
  objects, and start the application. Put server startup, shutdown, and signal handling
  behavior in an application or server class.
- Separate transport handling, application use cases, domain rules, and infrastructure
  where those responsibilities exist. Controllers adapt HTTP input/output; services
  coordinate use cases; domain objects protect business invariants; repositories and
  clients encapsulate storage and external integrations.
- Introduce only the layers needed by the current feature. Do not scaffold empty
  controllers, services, repositories, or factories.

## Classes and dependencies

- Prefer composition over inheritance. Use inheritance only for a real substitutable
  relationship, not as a shortcut for sharing implementation.
- Inject collaborators through constructors. Use narrow TypeScript interfaces at external
  boundaries or where interchangeable implementations are needed; do not add an interface
  for every class by default.
- Keep state private and make dependencies readonly where possible. Expose a small public
  API expressing capabilities, rather than mutable fields or unrestricted setters.
- Put class-specific helpers inside their owning class as private methods, including
  helpers without instance state. Extract a collaborator when it owns a separate concern.
- Avoid global mutable state, service locators, static service classes, and hidden
  construction of dependencies inside business methods.
- Keep configuration shapes, DTOs, and other plain data as types or interfaces. A genuinely
  shared pure utility may remain a function; do not wrap plain data or independent pure
  operations in classes solely for appearance.
- Preserve method context when passing class methods to Node callbacks, event listeners,
  or route handlers, using a bound method or a small delegating callback.

## Polymorphism

- Treat polymorphism as a core design tool when backend behavior has real variants:
  providers, repositories, strategies, or transports. Express the shared capability as
  a narrow interface and implement each variant in a cohesive class.
- Make consumers depend on that contract and invoke its behavior without knowing the
  concrete implementation. Select and inject implementations at the composition root
  or a dedicated factory.
- Prefer polymorphic dispatch over repeated switches on provider names, type flags,
  `instanceof` checks, or casts in business logic. Keep necessary selection logic at the
  wiring boundary so adding an implementation does not require changing its consumers.
- Preserve substitutability: every implementation must honor the contract's input,
  output, error, and lifecycle guarantees without stronger preconditions or weaker
  guarantees. Do not require consumers to special-case individual implementations.
- Use interface-based polymorphism with composition by default. Introduce an abstract
  base class only when implementations genuinely share behavior and invariants.
- Validate shared observable guarantees across implementations and use test doubles
  through the same contract. Avoid speculative hierarchies when no actual variation exists.

## Changes and validation

- Inspect affected callers and preserve observable behavior and public contracts.
- Refactor the code needed for the requested feature into coherent objects. Leave unrelated
  backend and frontend code outside the change.
- Verify meaningful behavior through public APIs with injected test doubles where useful;
  avoid tests that reach into private methods or merely assert the class structure.
- Run the server typecheck and build. For startup or HTTP changes, verify startup, affected
  endpoints, and shutdown. Development runs with `tsx watch`; type checking remains a
  separate `tsc` command.
