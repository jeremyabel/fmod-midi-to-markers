var MidiParser = studio.system.require("utils/midi-parser.js");
var TypedArray = studio.system.require("utils/typed-array.js");

studio.menu.addMenuItem({ 
	name: "MIDI To Markers",
	isEnabled: function() { var event = studio.window.browserCurrent(); return event && event.isOfExactType("Event"); }, 
	keySequence: "Ctrl+Shift+M",
	execute: function() {

		var event = studio.window.browserCurrent();

		var addAtLabel = "MIDI Markers will be added at the current playhead position.";
		var currentSelection = studio.window.editorCurrent();
		var insertTime = event.getPlayheadPosition(event.timeline);

		if (currentSelection)
		{
			if (currentSelection.entity === "NamedMarker")
			{
				addAtLabel = "MIDI Markers will be added at the \n\"" + currentSelection.name + "\" marker.";
			}
			else
			{
				addAtLabel = "MIDI Markers will be added at the start of the \ncurrently-selected " + currentSelection.entity + ".";
			}

			// Get insert time depending on what selection properties are available
			if (currentSelection.hasOwnProperty("position"))
			{
				insertTime = currentSelection.position;
			}
			else if (currentSelection.hasOwnProperty("start"))
			{
				insertTime = currentSelection.start;
			}
			else
			{
				addAtLabel = "MIDI Markers will be added at the current playhead position.";
				insertTime = event.getPlayheadPosition(event.timeline);
			}
		}

		function doMidiToMarkers(widget) {

			var path = widget.findWidget("m_midiFilePath").text();
				
			// Check for .mid file extension
			if (path.substr(path.length - 4).toUpperCase() !== ".MID" )
			{
				studio.system.message("Not a MIDI file: " + path);
				return;
			}

			var file = studio.system.getFile(path);
			var pathForBase64 = path + '.tmp';

			if (file.exists())
			{
				// Convert MIDI to base64 for Windows
				if (studio.os.platform === 'win')
				{
					var toBase64Proc = studio.system.start("certutil", {
						args: ["-f", "-encode", path, pathForBase64]
					});

					if (toBase64Proc.exitCode !== 0)
					{
						studio.system.message("Error running certutil: " + toBase64Proc.standardError);
						return;
					}
				}

				// Convert MIDI to base64 for OSX
				else if (studio.os.platform === 'mac')
				{
					var toBase64Proc = studio.system.start("openssl", {
						args: ["base64", "-in", path, "-out", pathForBase64]
					});

					if (toBase64Proc.exitCode !== 0)
					{
						studio.system.message("Error running openssl: " + toBase64Proc.standardError);
						return;
					}
				}

				file = studio.system.getFile(pathForBase64);

				if (file.exists())
				{
					if (file.open(studio.system.openMode.ReadOnly))
					{
						var fileSize = file.size();
						var fileText = file.readText(fileSize);
						file.remove();

						console.log("==== Parsing MIDI File: " + path + " ====");

						// Remove the certificate prefix and suffix that Windows adds
						if (studio.os.platform === 'win')
						{
							fileText = fileText.substr(28);
							fileText = fileText.substr(0, fileText.length - 27);
						}

						var parsedMidi = MidiParser.parse(fileText, TypedArray);

						// Make a new marker track for each midi track, if requested
						if (widget.findWidget("m_createNewMarkerTracks").isChecked())
						{
							parsedMidi.track.forEach(function() {
								event.addMarkerTrack();
							});
						}

						// Get the list of all marker tracks, including the new ones
						var markerTracks = studio.project.model.MarkerTrack.findInstances({
							searchContext: studio.window.browserCurrent()
						});

						// If there aren't enough marker tracks, exit with an error
						if (markerTracks.length < parsedMidi.tracks) 
						{
							studio.system.message("Error: Number of marker tracks does not match number of MIDI tracks. " + parsedMidi.tracks + " track(s) are required.");
							return;
						}

						var ticksPerQuarter = parsedMidi.timeDivision;
						var microsecondsPerQuarter = 50000;
						var microsecondsPerTick = microsecondsPerQuarter / ticksPerQuarter;
						var eventCounter = 0;

						parsedMidi.track.forEach(function(track, i) 
						{
							var markerTrack = markerTracks[(markerTracks.length - parsedMidi.tracks) + i];
							var ticks = 0;

							var noteOnEvents = track.event.filter(function(event) {
								return event.type === 0x9 && event.data[1] > 0;
							});

							var noteOffEvents = track.event.filter(function(event) {
								return event.type === 0x8 || (event.type === 0x9 && event.data[1] === 0);
							});

							var trackName = track.event.find(function(event) {
								return event.metaType === 0x03;
							}).data;

							var tempoEvent = track.event.find(function(event) {
								return event.metaType === 0x51;
							});

							// Set up initial tempo variables
							if (tempoEvent) 
							{
								microsecondsPerQuarter = tempoEvent.data;
								microsecondsPerTick = microsecondsPerQuarter / ticksPerQuarter;

								console.log("Microseconds Per Quarter: " + microsecondsPerQuarter);
								console.log("Microseconds Per Tick: " + microsecondsPerTick);
							}

							console.log("Adding MIDI Track: " + trackName);

							noteOnEvents.forEach(function(event, i) {
								ticks += event.deltaTime;

								var microseconds = ticks * microsecondsPerTick;
								var seconds = microseconds / 1000000;

								markerTrack.addNamedMarker("N, " + trackName + ", " + event.data[0], insertTime + seconds);

								ticks += noteOffEvents[i].deltaTime;
								eventCounter++;
							});
						});

						console.log(eventCounter + " markers were successfully added.");
					}
					else
					{
						studio.system.message("Could not open temp file: " + pathForBase64);
					}
				}
				else
				{
					studio.system.message("Could not find temp file: " + pathForBase64);
				}
			}
			else
			{
				studio.system.message("Invalid file: " + path);
			}
		}

		studio.ui.showModalDialog({
            windowTitle: "MIDI To Markers",
            windowWidth: 340,
            windowHeight: 120,
            widgetType: studio.ui.widgetType.Layout,
            layout: studio.ui.layoutType.VBoxLayout,
            items: [

            	{ widgetType: studio.ui.widgetType.Label, widgetId: "m_midiFilePathLabel", text: "MIDI File Path" },
            	{ 
            		widgetType: studio.ui.widgetType.PathLineEdit,
            		widgetId: "m_midiFilePath",
            		// text: "*.mid",
            		text: "D:/Downloads/Citywalk music midi/Citywalk music midi/Citywalk2.mid",
            		pathType: studio.ui.pathType.OpenFile
            	},

            	{ 
            		widgetType: studio.ui.widgetType.CheckBox,
            		widgetId: "m_createNewMarkerTracks",
            		text: "Create new marker tracks",
            		isChecked: true
            	},

            	{
            		widgetType: studio.ui.widgetType.Label,
            		widgetId: "m_midiAddAtLabel",
            		text: addAtLabel
            	},

            	{
            		widgetType: studio.ui.widgetType.Layout,
            		layout: studio.ui.layoutType.HBoxLayout,
            		contentsMargins: { left: 0, top: 12, right: 0, bottom: 0 },
            		items: [
            			{ widgetType: studio.ui.widgetType.Spacer, sizePolicy: { horizontalPolicy: studio.ui.sizePolicy.MinimumExpanding } },
            			{ widgetType: studio.ui.widgetType.PushButton, text: "Add MIDI Markers", onClicked: function() { doMidiToMarkers(this); this.closeDialog(); } }
            		]
            	}
            ]
        });
	}
});