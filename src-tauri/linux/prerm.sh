#!/bin/sh
# Removes the `compresso` command made by postinst.sh (made again when the package is upgraded)
if [ -L /usr/bin/compresso ]; then
  rm -f /usr/bin/compresso
fi
