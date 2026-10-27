#!/bin/sh
cwd="$PWD"
bs_dir="$(dirname $(readlink -f $0))"
rm -rf "${bs_dir}"/autom4te.cache
rm -f "${bs_dir}"/aclocal.m4 "${bs_dir}"/ltmain.sh

echo 'Running autoreconf -if...'
autoreconf -if || exit 1
if test -z "$NOCONFIGURE" ; then
	echo 'Configuring...'
	cd "${bs_dir}" &> /dev/null
	test "$?" = "0" || e=1
	test "$cwd" != "$bs_dir" && cd "$bs_dir" &> /dev/null
	./configure $@
	test "$e" = "1" && exit 1
	cd "$cwd"
fi
