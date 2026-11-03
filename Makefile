VALE_STYLES = .vale/styles

.PHONY: lint ensure-styles sync-styles

lint: ensure-styles sync-styles
	vale README.md docs/adr/*.md docs/live-view.md tickets/README.md

sync-styles:
	npx vale-rules sync

ensure-styles:
	@[ -f $(VALE_STYLES)/write-good/Passive.yml ] || (git clone -q --depth=1 https://github.com/errata-ai/write-good $(VALE_STYLES)/write-good && cd $(VALE_STYLES)/write-good && if [ -d write-good ]; then mv write-good/* .; rmdir write-good; fi && find . -maxdepth 1 -name '*.yml' ! -name '*.rules.yml' | while read f; do grep -q extends $$f || rm $$f; done)
