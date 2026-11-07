"""Original primitive controls distinguishing cubic range and state hypotheses.

No corpus input or native raster claim. Seeds, geometry and generators are original.
"""
from pathlib import Path
import argparse, gzip, hashlib, json, random
from svg_cubic_step_fixture import split


def inputs():
    rows = []
    heights = [255,510,511,511.0625,511.25,511.4375,511.5,511.5625,512,513,
               900,1022,1022.5,1022.9375,1023,1024,1820]
    shapes = {
        's': lambda h: [[0,0],[256,h],[0,-h],[256,0]],
        'arch': lambda h: [[0,0],[256,h],[0,h],[256,0]],
        'skew': lambda h: [[0,0],[256,h],[0,h/2],[256,-h]],
        'ramp': lambda h: [[0,0],[256,h/3],[0,2*h/3],[256,h]],
        'loop': lambda h: [[0,0],[256,h],[-256,-h],[0,0]],
        'box': lambda h: [[0,0],[h,256],[h,0],[0,256]],
    }
    for shape, points in shapes.items():
        for height in heights:
            for phase in [0,.5]:
                pts = [[x+phase,y+phase] for x,y in points(height)]
                for name, segment in [('whole',pts),*zip(['left','right'],split(pts))]:
                    rows.append(dict(name=f'{shape}/h{height}/phase{phase}/{name}',
                        shape=shape,height=height,phase=phase,representation=name,points=segment))
    seeded = []
    rng = random.Random(20261003)
    for curve in range(24):
        base = [[rng.randint(-256,256),rng.randint(-256,256)] for _ in range(4)]
        axis = curve%2
        lo,hi = min(p[axis] for p in base),max(p[axis] for p in base)
        for span in [1022.9375,1023,1023.0625,1536,4096]:
            points = [[round((v-lo if k==axis else v)/(hi-lo)*span*16)/16
                       for k,v in enumerate(p)] for p in base]
            for phase in [0,.5,65536]:
                seeded.append(dict(name=f'seed-{curve}/span{span}/phase{phase}',
                    points=[[x+phase,y+phase] for x,y in points]))
    return {'cases.json':rows,'seed-cases.json':seeded}


def generate(out):
    out.mkdir(parents=True,exist_ok=True)
    for name, rows in inputs().items():
        (out/name).write_bytes((json.dumps(rows,indent=2)+'\n').encode())


def record(out,captures,repeats):
    sha=lambda b:hashlib.sha256(b).hexdigest()
    result={'scope':__doc__,'compressed':{}}
    for name,rows in inputs().items():
        data=(json.dumps(rows,indent=2)+'\n').encode()
        assert (out/name).read_bytes()==data
        capture=captures[name].read_bytes()
        native=json.loads(capture.decode('utf-8-sig'))
        assert native['inputSha256']==sha(data) and native['quantizeInput'] and native['tolerance']==.25
        assert [r['name'] for r in native['cases']]==[r['name'] for r in rows]
        assert json.loads(repeats[name].read_bytes().decode('utf-8-sig'))==native
        for key,raw in [(name,data),(name.replace('cases','native'),capture)]:
            packed=gzip.compress(raw,mtime=0);target=key+'.gz'
            (out/target).write_bytes(packed);result['compressed'][target]=sha(packed)
    (out/'reference.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('output',type=Path)
    generate(parser.parse_args().output)
