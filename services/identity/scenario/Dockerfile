# Alex's 43-step WeIdentity scenario (scenario.sh + Java harness), run against weid-rest on the compose network.
FROM gradle:7.6.4-jdk11@sha256:06c99a26fc18becd96b848324f21729e30a77dc1c4ac719edd2747c78a951347 AS build
WORKDIR /src
COPY java/build.gradle java/settings.gradle ./
COPY java/src ./src
RUN --mount=type=cache,target=/home/gradle/.gradle gradle -q --no-daemon installDist && mv build/install/* build/install/harness

FROM eclipse-temurin:11-jdk@sha256:e25e6f22a886aff4da695ac1a239c0f608ff997622a8c39d754066fffcd58ee3
RUN apt-get update && apt-get install -y --no-install-recommends jq openssl xxd python3 bsdmainutils curl && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/build/install/harness/lib /scenario/java/lib
COPY java/run.sh java/log4j2.xml /scenario/java/
COPY scenario.sh /scenario/
ENTRYPOINT ["bash", "/scenario/scenario.sh"]
