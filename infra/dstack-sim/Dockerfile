# dstack simulator 0.5.3 (the version phala CLI 1.1.22 installs, V5) for the tee-sim profile. Its key material is
# fixed and public: local and testnet only, never prod (I13).
FROM debian:bookworm-slim@sha256:7c7b2c966bc9ee8cedfeef67e0e279108992c77681fa595db4a9d65c06ccc587
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
ARG SIM_URL=https://github.com/Dstack-TEE/dstack/releases/download/v0.5.3/dstack-simulator-0.5.3-x86_64-linux-musl.tgz
ARG SIM_SHA256=8fd595ca812494ef0464ce9307153bda78930736799366084e1ae16e9dd531db
RUN curl -sSLf -o /tmp/sim.tgz "$SIM_URL" && echo "$SIM_SHA256  /tmp/sim.tgz" | sha256sum -c - \
  && mkdir -p /opt/sim && tar xzf /tmp/sim.tgz -C /opt/sim --strip-components=1 2>/dev/null; rm -f /tmp/sim.tgz /opt/sim/._* \
  && test -x /opt/sim/dstack-simulator && sed -i 's/^log_level = "debug"/log_level = "info"/' /opt/sim/dstack.toml
COPY entrypoint.sh /usr/local/bin/dstack-sim
ENTRYPOINT ["sh", "/usr/local/bin/dstack-sim"]
