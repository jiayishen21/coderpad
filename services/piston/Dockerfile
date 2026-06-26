FROM ghcr.io/engineer-man/piston:latest

COPY install-runtimes.cjs /install-runtimes.cjs
COPY start-with-runtimes.sh /start-with-runtimes.sh

RUN chmod +x /start-with-runtimes.sh

CMD ["/start-with-runtimes.sh"]
