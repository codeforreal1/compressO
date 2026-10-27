#!/bin/bash
# Peter Hyman, pete@peterhyman.com
# December 2020

# This program will return commit references based on Tags and Annotated Tags from git describe

usage() {
cat >&2  <<EOF
$(basename $0) command [-r]
all - entire git describe
commit - commit, omitting v
tagrev - tag revision count
major - major release version
ninor - minor release version
micro - micro release version
version - M.mic + [tag release count-HEAD commit]
-r -- get release tag only
EOF
exit 1
}

# showw message and usage
die() {
	echo "$1"
	usage
}

# return variables
# everything, with leading `v' and leading `g' for commits
describe_tag=
# abbreviated commit
commit=
# count of commits from last tag
tagrev=
# major version
major=
# minor version
minor=
# micro version
micro=
# get release or tag?
tagopt="--tags"

# get whole commit and parse
# if tagrev > 0 then add it and commit to micro version
# Expected format is:
# v#.###-g#######
init() {
	describe_tag=$(git describe $tagopt --long --abbrev=7)
	describe_tag=${describe_tag/v/}
	describe_tag=${describe_tag/g/}
	commit=$(echo $describe_tag | cut -d- -f3)
	tagrev=$(echo $describe_tag | cut -d- -f2)
	version=$(echo $describe_tag | cut -d- -f1)
	micro=${version: -2}
	[ $tagrev -gt 0 ] && micro=$micro-$tagrev-$commit
	minor=${version: -3:1}
	major=$(echo $version | cut -d. -f1)
}

[ ! $(which git) ] && die "Something very wrong: git not found."

[ $# -eq 0 ] && die "Must provide a command and optional argument."

# are we getting a release only?
if [ $# -eq 2 ]; then
	if [ $2 = "-r" ]; then
		tagopt=""
	else
		die "Invalid option. Must be -r or nothing."
	fi
fi

init

case "$1" in
	"all" )
		retval=$describe_tag
		;;
	"commit" )
		retval=$commit
		;;
	"tagrev" )
		retval=$tagrev
		;;
	"version" )
		retval=$version
		;;
	"major" )
		retval=$major
		;;
	"minor" )
		retval=$minor
		;;
	"micro" )
		retval=$micro
		;;
	* )
		die "Invalid command."
		;;
esac

echo $retval

exit 0
