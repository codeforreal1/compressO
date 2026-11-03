#!/bin/sh
# The `compresso` command (see `src/sys/cli_install.rs`): the command line tool is installed as
# /usr/bin/compresso-cli, as `compresso` would clash with the app on systems that ignore case
ln -sf /usr/bin/compresso-cli /usr/bin/compresso
