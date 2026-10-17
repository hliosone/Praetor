# WeCross 1.4.0 (spec 00, V4, M12): the router and the account manager, JDK 8, from the pinned release tarballs.
# Plugins: the stock BCOS3 stub (FISCO) and Praetor's EVM stub (Base); the other stubs are removed. The account
# manager gets one recompiled class (patches/account-manager/Default.java: the "EVM" chain account type).
# Build context: the repository root (the EVM stub's sources).
FROM gradle@sha256:213476fe3598a433b19077b5b85ae95656cc0cba6fbc707d598c5a7ee865c52f AS stub
COPY --chown=gradle:gradle wecross/evm-stub /home/gradle/evm-stub
WORKDIR /home/gradle/evm-stub
RUN gradle jar --no-daemon -q && ls build/libs/praetor-evm-stub-1.0.0.jar

FROM eclipse-temurin:8-jdk@sha256:c4c47c71319207b45be56e96988351a34633a93033c298262d6b575de54f7cc8
ARG WECROSS_SHA256=2af207f6e173827aab24044e8579f90dfb156c576d169f8a93231a07e6a910bf
ARG AM_SHA256=4823a943e1bfeb6407d35f1668cf7d66a3b6a6ec5ff95055563a32d751dfb9b4
RUN apt-get update && apt-get install -y --no-install-recommends curl openssl python3 && rm -rf /var/lib/apt/lists/*
WORKDIR /opt
RUN curl -fsSL -o WeCross.tar.gz https://github.com/WeBankBlockchain/WeCross/releases/download/v1.4.0/WeCross.tar.gz \
  && echo "${WECROSS_SHA256}  WeCross.tar.gz" | sha256sum -c - \
  && curl -fsSL -o am.tar.gz https://github.com/WeBankBlockchain/WeCross-Account-Manager/releases/download/v1.4.0/WeCross-Account-Manager.tar.gz \
  && echo "${AM_SHA256}  am.tar.gz" | sha256sum -c - \
  && tar xzf WeCross.tar.gz && tar xzf am.tar.gz && rm WeCross.tar.gz am.tar.gz \
  && rm -f WeCross/plugin/bcos2-stub-*.jar WeCross/plugin/fabric*-stub-*.jar
COPY --from=stub /home/gradle/evm-stub/build/libs/praetor-evm-stub-1.0.0.jar /opt/WeCross/plugin/
COPY infra/wecross/patches/account-manager/Default.java /tmp/patch/Default.java
RUN mkdir -p /tmp/patch/out \
  && javac -source 8 -target 8 -cp "/opt/WeCross-Account-Manager/apps/*:/opt/WeCross-Account-Manager/lib/*" -d /tmp/patch/out /tmp/patch/Default.java \
  && (cd /tmp/patch/out && jar uf /opt/WeCross-Account-Manager/apps/wecross-account-manager-1.4.0.jar com/webank/wecross/account/service/config/Default.class) \
  && rm -rf /tmp/patch
COPY infra/wecross/entrypoint.sh /opt/entrypoint.sh
ENTRYPOINT ["bash", "/opt/entrypoint.sh"]
