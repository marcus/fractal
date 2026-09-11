.PHONY: dev check test build

dev:
	npm run dev -- --host 127.0.0.1 --port 5199

check:
	npm run check
	npm test

test:
	npm run test:browser

build:
	npm run build
