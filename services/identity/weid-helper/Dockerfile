# weid-helper (spec 05): the WeIdentity SDK operations the REST service lacks. Docker network only.
FROM gradle:7.6.4-jdk11@sha256:06c99a26fc18becd96b848324f21729e30a77dc1c4ac719edd2747c78a951347 AS build
WORKDIR /src
COPY build.gradle settings.gradle ./
COPY src ./src
RUN --mount=type=cache,target=/home/gradle/.gradle gradle -q --no-daemon installDist

FROM eclipse-temurin:11-jre@sha256:d218907a19a41f9036cf547a0a84a408cfb1bc56aeb2be090ae867563e086458
COPY --from=build /src/build/install/weid-helper/lib /app/lib
COPY log4j2.xml /app/log4j2.xml
COPY entrypoint.sh /usr/local/bin/weid-helper
WORKDIR /app
ENTRYPOINT ["bash", "/usr/local/bin/weid-helper"]
