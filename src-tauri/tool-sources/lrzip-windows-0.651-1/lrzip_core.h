/*
   Copyright (C) 2006-2016,2022 Con Kolivas
   Copyright (C) 2011 Peter Hyman
   Copyright (C) 1998-2003 Andrew Tridgell

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
#ifndef LRZIP_CORE_H
#define LRZIP_CORE_H

#include "lrzip_private.h"

i64 get_ram(rzip_control *control);
i64 nloops(i64 seconds, uchar *b1, uchar *b2);
bool write_magic(rzip_control *control);
bool read_magic(rzip_control *control, int fd_in, i64 *expected_size);
bool preserve_perms(rzip_control *control, int fd_in, int fd_out);
int open_tmpoutfile(rzip_control *control);
bool flush_tmpout(rzip_control *control);
int open_tmpinfile(rzip_control *control);
bool read_tmpinfile(rzip_control *control, int fd_in);
bool decompress_file(rzip_control *control);
bool get_header_info(rzip_control *control, int fd_in, uchar *ctype, i64 *c_len, i64 *u_len, i64 *last_head);
bool get_fileinfo(rzip_control *control);
bool compress_file(rzip_control *control);
bool write_fdout(rzip_control *control, void *buf, i64 len);
bool write_fdin(rzip_control *control);
void close_tmpoutbuf(rzip_control *control);
void clear_tmpinbuf(rzip_control *control);
bool clear_tmpinfile(rzip_control *control);
void close_tmpinbuf(rzip_control *control);
bool initialise_control(rzip_control *control);
#define initialize_control(_control) initialise_control(_control)
extern void zpaq_compress(uchar *c_buf, i64 *c_len, uchar *s_buf, i64 s_len, int level,
			  FILE *msgout, bool progress, long thread);
extern void zpaq_decompress(uchar *s_buf, i64 *d_len, uchar *c_buf, i64 c_len,
			    FILE *msgout, bool progress, long thread);

#endif
