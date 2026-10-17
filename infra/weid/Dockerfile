# JDK 11 toolbox for WeIdentity (Build-Tools deploy job and the 43-step scenario), pinned (Q5, V3).
FROM eclipse-temurin:11-jdk@sha256:e25e6f22a886aff4da695ac1a239c0f608ff997622a8c39d754066fffcd58ee3
RUN apt-get update && apt-get install -y --no-install-recommends gettext-base git curl procps jq openssl xxd python3 bsdmainutils \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /work
COPY deploy.sh /usr/local/bin/weid-deploy
ENTRYPOINT ["bash", "/usr/local/bin/weid-deploy"]
