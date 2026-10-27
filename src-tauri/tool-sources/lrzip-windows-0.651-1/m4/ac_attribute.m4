dnl Copyright (C) 2004-2008 Kim Woelders
dnl Copyright (C) 2008 Vincent Torri <vtorri at univ-evry dot fr>
dnl That code is public domain and can be freely used or copied.
dnl Originally snatched from somewhere...

dnl Macro for checking if the compiler supports __attribute__

dnl Usage: AC_C___ATTRIBUTE__
dnl call AC_DEFINE for HAVE___ATTRIBUTE__ and __UNUSED__
dnl if the compiler supports __attribute__, HAVE___ATTRIBUTE__ is
dnl defined to 1 and __UNUSED__ is defined to __attribute__((unused))
dnl otherwise, HAVE___ATTRIBUTE__ is not defined and __UNUSED__ is
dnl defined to nothing.

AC_DEFUN([AC_C___ATTRIBUTE__],
[

AC_MSG_CHECKING([for __attribute__])

AC_CACHE_VAL([ac_cv___attribute__],
   [AC_TRY_COMPILE(
       [
#include <stdlib.h>

int func(int x);
int foo(int x __attribute__ ((unused)))
{
   exit(1);
}
       ],
       [],
       [ac_cv___attribute__="yes"],
       [ac_cv___attribute__="no"]
    )])

AC_MSG_RESULT($ac_cv___attribute__)

if test "x${ac_cv___attribute__}" = "xyes" ; then
   AC_DEFINE([HAVE___ATTRIBUTE__], [1], [Define to 1 if your compiler has __attribute__])
   AC_DEFINE([__UNUSED__], [__attribute__((unused))], [Macro declaring a function argument to be unused])
  else
    AC_DEFINE([__UNUSED__], [], [Macro declaring a function argument to be unused])
fi

])

dnl End of ac_attribute.m4
