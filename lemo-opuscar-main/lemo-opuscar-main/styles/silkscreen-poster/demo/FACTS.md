# FACTS · The Long Way Home

Every number and year printed on the ticket stubs or spoken in the narration.

## Distances (great-circle, from Beijing)

Method: haversine formula on a sphere of mean Earth radius 6,371.0088 km (IUGG mean radius R1), city-centre coordinates as listed on each city's Wikipedia page; rounded to the nearest 10 km on the stubs, to the nearest thousand in the narration. Recompute with the snippet at the end.

| City | Coordinates | Distance from Beijing | On the stub | Spoken |
|---|---|---|---|---|
| Beijing | 39.9042 N, 116.4074 E | 0 km | 0 KM | "zero kilometres" |
| Istanbul | 41.0082 N, 28.9784 E | 7,056 km | 7,060 KM | "seven thousand" |
| Paris | 48.8566 N, 2.3522 E | 8,217 km | 8,220 KM | "eight thousand two hundred" |
| Buenos Aires | 34.6037 S, 58.3816 W | 19,267 km | 19,270 KM | "nineteen thousand" |

- Farthest point on Earth from Beijing (its antipode, 39.9 S, 63.6 W, in Argentina): 20,015 km = half the circumference of that sphere. Basis for "on a round world, that is almost as far as you can go" (19,267 / 20,015 = 96 %).
- Route legs: Beijing–Istanbul 7,056, Istanbul–Paris 2,256, Paris–Buenos Aires 11,050, Buenos Aires–Beijing 19,267; total 39,629 km → stub "TRAVELLED 39,630 KM", spoken "thirty-nine thousand six hundred". Equatorial circumference 40,075 km (WGS 84), so the loop is "almost once around the world" (99 %).
- The trip itself (days, the traveller) is fiction; only the geometry is fact.

## Landmarks (year on the stub)

| Stub | Fact | Source |
|---|---|---|
| TEMPLE OF HEAVEN · BUILT 1420 | Temple of Heaven complex built 1406–1420 under the Yongle Emperor (the present Hall of Prayer for Good Harvests is the 1890 rebuild after the 1889 fire) | UNESCO World Heritage List no. 881, https://whc.unesco.org/en/list/881 ; https://en.wikipedia.org/wiki/Temple_of_Heaven |
| HAGIA SOPHIA · BUILT 537 | completed and dedicated in 537 under Justinian I | https://en.wikipedia.org/wiki/Hagia_Sophia ; UNESCO no. 356 (Historic Areas of Istanbul) |
| EIFFEL TOWER · BUILT 1889 | completed for the 1889 Exposition Universelle | https://www.toureiffel.paris/en/the-monument/history |
| OBELISCO · BUILT 1936 | the Obelisco de Buenos Aires, inaugurated 23 May 1936 | https://en.wikipedia.org/wiki/Obelisco_de_Buenos_Aires |

## Recompute

```python
from math import radians, sin, cos, asin, sqrt
R = 6371.0088
def d(a, b):
    (p1, l1), (p2, l2) = [(radians(x), radians(y)) for x, y in (a, b)]
    return 2 * R * asin(sqrt(sin((p2 - p1) / 2) ** 2 + cos(p1) * cos(p2) * sin((l2 - l1) / 2) ** 2))
```
