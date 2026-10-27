dnl Copyright (C) 2008 Vincent Torri <vtorri at univ-evry dot fr>
dnl That code is public domain and can be freely used or copied.

dnl Macro that check if doxygen is available or not.

dnl EFL_CHECK_DOXYGEN([ACTION-IF-FOUND [, ACTION-IF-NOT-FOUND]])
dnl Test for the doxygen program
dnl Defines efl_doxygen
dnl Defines the automake conditionnal EFL_BUILD_DOC
dnl
AC_DEFUN([EFL_CHECK_DOXYGEN],
[

dnl
dnl Disable the build of the documentation
dnl
AC_ARG_ENABLE([doc],
   [AC_HELP_STRING(
       [--disable-doc],
       [Disable documentation build @<:@default=enabled@:>@])],
   [
    if test "x${enableval}" = "xyes" ; then
       efl_enable_doc="yes"
    else
       efl_enable_doc="no"
    fi
   ],
   [efl_enable_doc="yes"])

AC_MSG_CHECKING([whether to build documentation])
AC_MSG_RESULT([${efl_enable_doc}])

if test "x${efl_enable_doc}" = "xyes" ; then

dnl
dnl Specify the file name, without path
dnl

   efl_doxygen="doxygen"

   AC_ARG_WITH([doxygen],
      [AC_HELP_STRING(
          [--with-doxygen=FILE],
          [doxygen program to use @<:@default=doxygen@:>@])],
dnl
dnl Check the given doxygen program.
dnl
      [efl_doxygen=${withval}
       AC_CHECK_PROG([efl_have_doxygen],
          [${efl_doxygen}],
          [yes],
          [no])
       if test "x${efl_have_doxygen}" = "xno" ; then
          echo "WARNING:"
          echo "The doxygen program you specified:"
          echo "${efl_doxygen}"
          echo "was not found.  Please check the path and make sure "
          echo "the program exists and is executable."
          AC_MSG_WARN([no doxygen detected. Documentation will not be built])
       fi
      ],
      [AC_CHECK_PROG([efl_have_doxygen],
          [${efl_doxygen}],
          [yes],
          [no])
       if test "x${efl_have_doxygen}" = "xno" ; then
          echo "WARNING:"
          echo "The doxygen program was not found in your execute path."
          echo "You may have doxygen installed somewhere not covered by your path."
          echo ""
          echo "If this is the case make sure you have the packages installed, AND"
          echo "that the doxygen program is in your execute path (see your"
          echo "shell manual page on setting the \$PATH environment variable), OR"
          echo "alternatively, specify the program to use with --with-doxygen."
          AC_MSG_WARN([no doxygen detected. Documentation will not be built])
       fi
      ])
fi

dnl
dnl Substitution
dnl
AC_SUBST([efl_doxygen])

if ! test "x${efl_have_doxygen}" = "xyes" ; then
   efl_enable_doc="no"
fi

AM_CONDITIONAL(EFL_BUILD_DOC, test "x${efl_enable_doc}" = "xyes")

if test "x${efl_enable_doc}" = "xyes" ; then
  m4_default([$1], [:])
else
  m4_default([$2], [:])
fi

])

dnl End of doxygen.m4
