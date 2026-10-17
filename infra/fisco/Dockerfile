# FISCO BCOS 3.17.1 node from the official release binary (sha256-checked by fetch.sh). Docker Hub has no 3.17.1
# image (V2). The binary is statically linked; curl is for the healthcheck.
FROM debian:bookworm-slim@sha256:7c7b2c966bc9ee8cedfeef67e0e279108992c77681fa595db4a9d65c06ccc587
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY downloads/fisco-bcos /usr/local/bin/fisco-bcos
WORKDIR /data
ENTRYPOINT ["/usr/local/bin/fisco-bcos"]
CMD ["-c", "config.ini", "-g", "config.genesis"]
