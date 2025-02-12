#!/usr/bin/env bash


# Set the current directory of shell file into a variable
current_dir=$(dirname "$0")
cd "$current_dir" 

echo '##############################'
echo '##'
echo '##'
echo '##'
echo "##  Building eyepop"
echo '##'
echo '##'
echo '##'
echo '##############################'
cd ../src/eyepop 
npm install > /dev/null
npm run build 


echo '##############################'
echo '##'
echo '##'
echo '##'
echo "##  Building eyepop-render-2d"
echo '##'
echo '##'
echo '##'
echo '##############################'
cd ../eyepop-render-2d
npm install > /dev/null
npm run build 
