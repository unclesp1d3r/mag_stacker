/**
 * The one place the test Postgres image is pinned.
 *
 * AWS ECR Public mirror of the Docker Official postgres image. It is not
 * subject to Docker Hub's unauthenticated per-IP pull limit, which otherwise
 * 429s on shared CI runner IPs. Digest-pinned for an immutable test runtime;
 * the `:17` tag is kept for readability.
 *
 * To bump: pull the tag, then `docker inspect --format='{{index .RepoDigests 0}}'`
 * for the new digest and update this constant — only this one. The CI pre-pull
 * action reads the value straight out of this module, and every test that starts
 * a container imports it, so nothing else needs touching. It previously appeared
 * verbatim in nine places with instructions to keep them in lockstep by hand.
 */
export const POSTGRES_IMAGE =
  "public.ecr.aws/docker/library/postgres:17@sha256:5c855ad7b85e68e48a62f34662853f38b57c1c1d80f3a927ab58034fd6d31c5e";

/** Database name used by every ephemeral test container. */
export const TEST_DB_NAME = "magstacker_test";
