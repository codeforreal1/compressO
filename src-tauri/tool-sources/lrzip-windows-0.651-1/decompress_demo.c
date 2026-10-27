/*
   Copyright (C) 2012 Con Kolivas

   This program is free software; you can redistribute it and/or modify
   it under the terms of the GNU General Public License as published by
   the Free Software Foundation; either version 2 of the License, or
   (at your option) any later version.

   This program is distributed in the hope that it will be useful,
   but WITHOUT ANY WARRANTY; without even the implied warranty of
   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
   GNU General Public License for more details.

   You should have received a copy of the GNU General Public License
   along with this program. If not, see <http://www.gnu.org/licenses/>.
*/

#ifdef HAVE_CONFIG_H
# include "config.h"
#endif
#undef NDEBUG
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <assert.h>
#include <Lrzip.h>

static const char *suffix_me(const char *file)
{
	const char *p;
	static char buf[4096];

	p = strrchr(file, '.');
	if (p && (strlen(p + 1) < 4))
		strncat(buf, file, p - file);
	else
		strcat(buf, file);
	return &buf[0];
}

int main(int argc, char *argv[])
{
	Lrzip *lr;
	if ((argc != 2) && (argc != 3)) {
		fprintf(stderr, "Usage: %s file [outfile]\n", argv[0]);
		exit(1);
	}
	lr = lrzip_new(LRZIP_MODE_DECOMPRESS);
	assert(lr);
	lrzip_config_env(lr);
	assert(lrzip_filename_add(lr, argv[1]));
	if (argc == 2)
		lrzip_outfilename_set(lr, suffix_me(argv[1]));
	else
		lrzip_outfilename_set(lr, argv[2]);
	assert(lrzip_run(lr));
	return 0;
}
