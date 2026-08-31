# Supported ADE runtime

Control Plane production images pin an exact `@alelouet/ai-delivery-engine`
version through the `ADE_VERSION` build argument. The current supported runtime
is `0.6.1`; the image also publishes the value as `ADE_RUNTIME_VERSION`.

The worker records the runtime version in the task execution log, and the
authenticated Dashboard overview displays it for operators. A future upgrade
must first run the ADE compatibility checks and representative task smoke tests,
then change `ADE_VERSION` in a dedicated PR. The image must never install the
floating `latest` tag.

The supported 0.6.1 contract used by Control Plane is:

- Node.js 22 or newer;
- `ade config validate` before agent work;
- `ade context pack <chill|normal|expert>` before agent work;
- `ade review --staged --json` before commit/push/PR;
- published CLI/templates/resources available from the exact npm release.

Project onboarding and compatibility refresh remain explicit lifecycle work in
issue #69; a runtime upgrade does not silently make a project compatible.
