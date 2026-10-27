#!/bin/bash

# Regression test.
#
# Copyright (C) 2016
# Ole Tange and Free Software Foundation, Inc.
#
# This program is free software; you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation; either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful, but
# WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
# General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program; if not, see <http://www.gnu.org/licenses/>
# or write to the Free Software Foundation, Inc., 51 Franklin St,
# Fifth Floor, Boston, MA 02110-1301 USA

bash > regressiontest.out 2>&1  <<'_EOS'
  rm -f testfile.lrz
  seq 1000 > testfile
  
  echo 'Test basic use'
    lrz testfile
  
  echo 'Test decompression in read-only dir'
    mkdir -p ro
    cp testfile.lrz ro
    chmod 500 ro
    cd ro
    lrz -dc testfile.lrz | wc
    cd ..
  
  echo 'this should be silent'
    lrz -d testfile.lrz
  
  echo 'man page for lrz should exist'
    man lrz >/dev/null
    echo $?
  
  echo 'compress stdin to stdout'
    cat testfile | lrz | cat > testfile.lrz
  
  echo 'Respect $TMPDIR'
    mkdir -p t
    chmod 111 t
    cd t
    TMPDIR=.. lrz -d < ../testfile.lrz | wc
    cd ..
    rm -rf t
  
  echo 'Decompress in read only dir'
    mkdir -p t
    chmod 111 t
    cd t
    lrz -d < ../testfile.lrz | wc
    cd ..
    rm -rf t
  
  echo 'Test -cd'
    mkdir -p t
    chmod 111 t
    cd t
    lrz -cd  ../testfile.lrz | wc
    cd ..
    rm -rf t

  echo 'Test -cfd should not remove testfile.lrz'
    mkdir -p t
    chmod 111 t
    cd t
    lrz -cfd  ../testfile.lrz | wc
    cd ..
    rm -rf t
    ls testfile.lrz

  echo 'Test -1c'
    lrz -1c testfile | wc

  echo 'Test -r'
    mkdir t
    touch t/t{1..10}
    lrz -r t
    ls t
    rm -r t

  echo 'Test tar compatibility'
    mkdir t
    touch t/t{1..10}
    tar --use-compress-program lrz -cvf testfile.tar.lrz t
    tar --use-compress-program lrz -tvf testfile.tar.lrz | wc -l
    rm -r t

  echo 'test compress of 1 GB data with parallel --pipe --compress'
    yes "`echo {1..100}`" |
      head -c 1G |
      parallel --pipe --block 100m --compress-program lrz cat |
      wc -c

  echo 'test compress of 1 GB with sort --compress-program'
    yes "`echo {1..100}`" |
      head -c 1G |
      sort --compress-program lrz |
      wc -c

  echo 'test should not lrz -dc removes file'
    rm testfile.lrz
    echo OK > testfile
    lrz testfile
    lrz -dc testfile.lrz
    ls testfile.lrz

_EOS

diff regressiontest.good regressiontest.out
