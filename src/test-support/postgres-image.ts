/**
 * The one place the test Postgres image is pinned.
 *
 * AWS ECR Public mirror of the Docker Official postgres image. It is not
 * subject to Docker Hub's unauthenticated per-IP pull limit, which otherwise
 * 429s on shared CI runner IPs. Digest-pinned for an immutable test runtime;
 * the `:17` tag is kept for readability.
 *
 * To bump: pull the tag, then `docker inspect --format='{{index .RepoDigests 0}}'`
 * for the new digest and update this constant AND the CI pre-pull step in
 * `.github/workflows/ci.yml`. This constant previously appeared verbatim in
 * both the e2e launcher and the backup round-trip test, which meant a bump had
 * to be made in lockstep in several files or the suites would silently pull
 * different runtimes.
 */
export const POSTGRES_IMAGE =
  "public.ecr.aws/docker/library/postgres:17@sha256:5c855ad7b85e68e48a62f34662853f38b57c1c1d80f3a927ab58034fd6d31c5e";

/** Database name used by every ephemeral test container. */
export const TEST_DB_NAME = "magstacker_test";
