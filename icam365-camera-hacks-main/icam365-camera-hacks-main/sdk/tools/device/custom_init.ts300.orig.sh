#!/bin/sh
#############################
# GPIO PINS CONFIGURATION
#############################
getHwInfo()
{
	grep -w $1 /bak/hardinfo.bin | awk -F '>'  '{print $2}' | awk -F '<' '{print $1}'
}

getHwCfg()
{
	grep $1 /bak/hwcfg.ini | awk '{printf $3}'
}

getHwInfoWifiPins()
{
	echo $(getHwInfo $1) | awk -F '_'  '{print $1}'
}

getHwInfoPinValidLvl()
{
	echo $(getHwInfo $1) | awk -F '_'  '{print $4}'
}

#wifi Power  ---
defSupport4G=$(getHwInfo Support4G)
support4G=$(getHwCfg support_4g)
ctrlPin=
validLvl=
if [ "$support4G" = "1" -o "$defSupport4G" = "1" ];then
	ctrlPin=$(getHwInfoWifiPins 4GCtrl)
	validLvl=$(getHwInfoPinValidLvl 4GCtrl)
else
	ctrlPin=$(getHwInfoWifiPins WifiCtrl)
	validLvl=$(getHwInfoPinValidLvl WifiCtrl)
fi

if [ -n "$ctrlPin" -a "$ctrlPin" != "-1" -a -n "$validLvl" ];then
	gio -do $ctrlPin 0
	if [ "$validLvl" = "1" ];then
		gio -s $ctrlPin 0
	else
		gio -s $ctrlPin 1
	fi
	sleep 2
	gio -s $ctrlPin $validLvl
fi
