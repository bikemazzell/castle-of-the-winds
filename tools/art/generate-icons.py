from pathlib import Path
import zlib,struct
# A newly drawn lantern, using only rectangles on a 32px grid.
rects=[(0,0,32,32,'#202a30'),(13,3,6,2,'#c6a76c'),(11,5,2,5,'#c6a76c'),(19,5,2,5,'#c6a76c'),(7,11,18,3,'#a29478'),(9,14,14,12,'#394e55'),(11,15,10,9,'#d6a34c'),(14,16,4,7,'#ffe3a0'),(7,26,18,3,'#a29478'),(9,14,2,12,'#736c5e'),(21,14,2,12,'#736c5e'),(15,14,2,12,'#817254')]
def chunk(t,d):return struct.pack('!I',len(d))+t+d+struct.pack('!I',zlib.crc32(t+d))
for size in [32,192,512]:
 buf=bytearray()
 for y in range(size):
  buf.append(0)
  for x in range(size):
   color='#202a30'
   for rx,ry,w,h,c in rects:
    if rx<=x*32//size<rx+w and ry<=y*32//size<ry+h:color=c
   buf.extend(bytes.fromhex(color[1:]))
 data=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('!2I5B',size,size,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(buf))+chunk(b'IEND',b'')
 Path(f'public/icons/icon-{size}.png').write_bytes(data)
