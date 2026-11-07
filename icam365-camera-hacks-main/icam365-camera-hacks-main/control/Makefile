ZIG ?= zig
CC ?= cc

BUILD_DIR := build
SOURCE := src/tangecam-control.c
COMMON_FLAGS := -std=c11 -Os -Wall -Wextra -Wpedantic -Werror \
	-ffunction-sections -fdata-sections
COMMON_LDFLAGS := -Wl,--gc-sections

.DEFAULT_GOAL := armv7

.PHONY: armv7 native test clean

armv7: $(BUILD_DIR)/tangecam-control-armv7

native: $(BUILD_DIR)/tangecam-control-native

$(BUILD_DIR):
	mkdir -p $@

$(BUILD_DIR)/tangecam-control-armv7: $(SOURCE) | $(BUILD_DIR)
	$(ZIG) cc -target arm-linux-musleabihf -mcpu=generic+v7a \
		$(COMMON_FLAGS) -static -s $(COMMON_LDFLAGS) $< -o $@

$(BUILD_DIR)/tangecam-control-native: $(SOURCE) | $(BUILD_DIR)
	$(CC) $(COMMON_FLAGS) $(COMMON_LDFLAGS) $< -o $@

test: native
	uv run tests/test_service.py $(BUILD_DIR)/tangecam-control-native

clean:
	rm -rf $(BUILD_DIR)
