ACLOCAL_AMFLAGS = -I m4
MAINTAINERCLEANFILES = \
Makefile.in \
aclocal.m4 \
config.guess \
config.h.in \
config.h.in~ \
config.sub \
configure \
depcomp \
install-sh \
ltconfig \
ltmain.sh \
missing \
$(PACKAGE_TARNAME)-$(PACKAGE_VERSION).tar.gz \
$(PACKAGE_TARNAME)-$(PACKAGE_VERSION).tar.bz2 \
$(PACKAGE_TARNAME)-$(PACKAGE_VERSION).tar.xz \
$(PACKAGE_TARNAME)-$(PACKAGE_VERSION).tar.lrz \
$(PACKAGE_TARNAME)-$(PACKAGE_VERSION)-doc.tar.bz2 \
m4/libtool.m4 \
m4/lt~obsolete.m4 \
m4/ltoptions.m4 \
m4/ltsugar.m4 \
m4/ltversion.m4

SUBDIRS = lzma man doc

AM_CFLAGS = -I. -I lzma/C -DNDEBUG
AM_CXXFLAGS = $(AM_CFLAGS)

lrztardir = $(bindir)
lrztar_SCRIPTS = lrztar

noinst_LTLIBRARIES = libtmplrzip.la
libtmplrzip_la_SOURCES = \
  lrzip_private.h \
  lrzip.c \
  lrzip_core.h \
  rzip.h \
  rzip.c \
  runzip.c \
  runzip.h \
  stream.c \
  stream.h \
  util.c \
  util.h \
  md5.c \
  md5.h \
  aes.c \
  aes.h \
  sha4.c \
  sha4.h \
  mman.c \
  mman.h \
  misc.cpp \
  misc.h \
  libzpaq/libzpaq.cpp \
  libzpaq/libzpaq.h

libtmplrzip_la_LIBADD = lzma/C/liblzma.la


bin_PROGRAMS = lrzip
lrzip_SOURCES = \
  main.c
nodist_EXTRA_lrzip_SOURCES = dummyy.cxx

lrzip_LDADD = libtmplrzip.la
if STATIC
  lrzip_LDFLAGS = -all-static
endif
LDFLAGS = -lws2_32

dist_doc_DATA = \
  AUTHORS \
  BUGS \
  ChangeLog \
  COPYING \
  README.md \
  README-NOT-BACKWARD-COMPATIBLE \
  TODO \
  WHATS-NEW

lrzipdir = $(includedir)

EXTRA_DIST = \
		lrztar \
		description-pak \
		autogen.sh \
		INSTALL \
		$(dist_doc_DATA)

install-exec-hook:
	$(LN_S) -f lrzip$(EXEEXT) $(DESTDIR)$(bindir)/lrunzip$(EXEEXT)
	$(LN_S) -f lrzip$(EXEEXT) $(DESTDIR)$(bindir)/lrzcat$(EXEEXT)
	$(LN_S) -f lrztar$(EXEEXT) $(DESTDIR)$(bindir)/lrzuntar$(EXEEXT)
	$(LN_S) -f lrzip$(EXEEXT) $(DESTDIR)$(bindir)/lrz$(EXEEXT)


uninstall-local:
	rm -f $(bindir)/lrunzip
	rm -f $(bindir)/lrzcat
	rm -f $(bindir)/lrzuntar
	rm -f $(bindir)/lrz

.PHONY: doc

# Documentation

doc: all
	@echo "entering doc/"
	$(MAKE) -C doc doc

