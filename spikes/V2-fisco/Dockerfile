# FISCO BCOS 3.17.1 node image built from the official release binary.
# Docker Hub has no fiscoorg/fiscobcos:v3.17.1 tag (latest published is v3.12.1), so this is the
# spec 04 fallback. The binary is statically linked, so a slim base is enough.
FROM debian:bookworm-slim
COPY downloads/fisco-bcos /usr/local/bin/fisco-bcos
WORKDIR /data
ENTRYPOINT ["/usr/local/bin/fisco-bcos"]
CMD ["-c", "config.ini", "-g", "config.genesis"]
