@echo off
rem Run by the "GEB feature request bot" scheduled task. Output goes to bot\bot.log.
cd /d "%~dp0.."
node bot\bot.mjs >> bot\bot.log 2>&1
