// Astrogrm Master Mixer

#feature-id Astrogrm > Master Mixer
#feature-info Combines two registered monochrome linear masters with normalized \
inverse-variance weights derived from scaled MRS noise estimates.

#include <pjsr/FrameStyle.jsh>
#include <pjsr/ColorSpace.jsh>
#include <pjsr/ImageOp.jsh>
#include <pjsr/SampleType.jsh>
#include <pjsr/Sizer.jsh>
#include <pjsr/StdButton.jsh>
#include <pjsr/StdIcon.jsh>
#include <pjsr/TextAlign.jsh>
#include <pjsr/UndoFlag.jsh>

#define TITLE "Astrogrm Master Mixer"
#define VERSION "0.1.0"
#define DEFAULT_OUTPUT_ID "AstrogrmMix"
#define SCALE_WARNING_RATIO 1.20

function MasterMixerModel()
{
   this.viewA = null;
   this.viewB = null;
   this.analysis = null;
}

function isUsableView( view )
{
   return view != null && view.isView && !view.isNull;
}

function validateInputs( viewA, viewB )
{
   if ( !isUsableView( viewA ) || !isUsableView( viewB ) )
      throw new Error( "Select both Master A and Master B." );

   if ( viewA.fullId == viewB.fullId )
      throw new Error( "Master A and Master B must be different views." );

   let imageA = viewA.image;
   let imageB = viewB.image;

   if ( imageA.isColor || imageB.isColor ||
        imageA.numberOfChannels != 1 || imageB.numberOfChannels != 1 )
      throw new Error( "Master A and Master B must be single-channel monochrome images." );

   if ( imageA.width != imageB.width || imageA.height != imageB.height )
      throw new Error( "Master A and Master B must have identical width and height." );
}

/*
 * This follows PixInsight's NoiseEvaluation convergence policy: start at four
 * MRS layers, accept at least 1% noise pixels, retry with fewer layers, and
 * use k-sigma when no acceptable MRS result is obtained for J >= 2.
 */
function evaluateNoise( image, reportProgress )
{
   image.pushSelections();
   try
   {
      image.resetSelections();

      reportProgress( "Computing Sn..." );
      let scale = image.Sn();
      if ( !isFinite( scale ) || !(scale > 0) || 1 + scale == 1 )
         throw new Error( "Image.Sn() returned zero or insignificant data." );

      let area = image.selectedRect.area;
      if ( !(area > 0) )
         throw new Error( "The image has no pixels." );

      let minimumCount = 0.01*area;
      let estimate;
      let layers = 4;
      let fallbackUsed = false;

      for ( ;; )
      {
         reportProgress( format( "MRS noise evaluation: %d layers...", layers ) );
         estimate = image.noiseMRS( layers );
         if ( estimate != null && estimate.length >= 2 &&
              isFinite( estimate[0] ) && estimate[0] > 0 &&
              isFinite( estimate[1] ) && estimate[1] >= minimumCount )
         {
            reportProgress( format( "Accepted: %.2f%% noise pixels", 100*estimate[1]/area ) );
            break;
         }

         let attemptPercent = estimate != null && estimate.length >= 2 && isFinite( estimate[1] )
                            ? 100*estimate[1]/area : 0;
         reportProgress( format( "Only %.2f%% noise pixels - insufficient", attemptPercent ) );

         if ( --layers == 1 )
         {
            reportProgress( "MRS did not converge." );
            reportProgress( "Using k-sigma fallback..." );
            estimate = image.noiseKSigma();
            fallbackUsed = true;
            break;
         }
      }

      if ( estimate == null || estimate.length < 2 ||
           !isFinite( estimate[0] ) || !(estimate[0] > 0) ||
           !isFinite( estimate[1] ) || estimate[1] < 0 )
         throw new Error( "Noise estimation failed." );

      let scaledSigma = estimate[0]/scale;
      if ( !isFinite( scaledSigma ) || !(scaledSigma > 0) )
         throw new Error( "Scaled noise estimation failed." );

      return {
         absoluteSigma: estimate[0],
         signalScale: scale,
         scaledSigma: scaledSigma,
         noisePixels: estimate[1],
         noisePercent: 100*estimate[1]/area,
         estimator: fallbackUsed ? "k-sigma" : "MRS",
         layers: fallbackUsed ? null : layers,
         fallbackUsed: fallbackUsed
      };
   }
   finally
   {
      image.popSelections();
   }
}

function analyzeMasters( viewA, viewB, setStatus )
{
   validateInputs( viewA, viewB );

   let totalTimer = new ElapsedTime;
   let timerA = new ElapsedTime;
   setStatus( "Analyzing Master A..." );
   console.writeln( "Analyzing Master A: ", viewA.fullId );
   console.flush();
   let noiseA = evaluateNoise( viewA.image, function( message )
   {
      console.writeln( "  ", message );
      console.flush();
   } );
   console.writeln( format( "  Master A complete in %.1f s", timerA.value ) );
   console.flush();

   let timerB = new ElapsedTime;
   setStatus( "Analyzing Master B..." );
   console.writeln( "Analyzing Master B: ", viewB.fullId );
   console.flush();
   let noiseB = evaluateNoise( viewB.image, function( message )
   {
      console.writeln( "  ", message );
      console.flush();
   } );
   console.writeln( format( "  Master B complete in %.1f s", timerB.value ) );
   console.flush();

   setStatus( "Calculating weights..." );
   console.writeln( "Calculating inverse-variance weights..." );
   console.flush();
   let rawWeightA = 1/(noiseA.scaledSigma*noiseA.scaledSigma);
   let rawWeightB = 1/(noiseB.scaledSigma*noiseB.scaledSigma);
   let weightSum = rawWeightA + rawWeightB;

   if ( !isFinite( weightSum ) || !(weightSum > 0) )
      throw new Error( "Unable to calculate finite inverse-variance weights." );

   let result = {
      viewAId: viewA.fullId,
      viewBId: viewB.fullId,
      noiseA: noiseA,
      noiseB: noiseB,
      relativeScale: noiseB.signalScale/noiseA.signalScale,
      scaleWarning: Math.max( noiseA.signalScale, noiseB.signalScale )/
                    Math.min( noiseA.signalScale, noiseB.signalScale ) > SCALE_WARNING_RATIO,
      weightA: rawWeightA/weightSum,
      weightB: rawWeightB/weightSum
   };
   console.writeln( format( "Analysis complete in %.1f s", totalTimer.value ) );
   console.flush();
   return result;
}

function numberLiteral( x )
{
   return format( "%.17g", x );
}

function mixingExpression( analysis )
{
   return numberLiteral( analysis.weightA ) + "*" + analysis.viewAId +
          " + " + numberLiteral( analysis.weightB ) + "*" + analysis.viewBId;
}

function writeNoiseResult( label, viewId, noise, weight )
{
   console.writeln( label, " (", viewId, "):" );
   console.writeln( format( "  absolute sigma: %.6e", noise.absoluteSigma ) );
   console.writeln( format( "  Sn:             %.6e", noise.signalScale ) );
   console.writeln( format( "  scaled sigma:   %.6e", noise.scaledSigma ) );
   console.writeln( format( "  noise pixels:   %d (%.2f%%)",
                            noise.noisePixels, noise.noisePercent ) );
   console.writeln( "  estimator:      ", noise.estimator );
   console.writeln( "  MRS layers:     ", noise.layers == null ? "--" : noise.layers );
   console.writeln( "  fallback used:  ", noise.fallbackUsed ? "yes" : "no" );
   console.writeln( format( "  normalized weight: %.8f (%.2f%%)", weight, 100*weight ) );
}

function writeAnalysisToConsole( analysis )
{
   console.show();
   console.writeln( "<end><cbr><br><b>", TITLE, " version ", VERSION, "</b>" );
   console.writeln( "Input view IDs: ", analysis.viewAId, ", ", analysis.viewBId );
   writeNoiseResult( "Master A", analysis.viewAId, analysis.noiseA, analysis.weightA );
   writeNoiseResult( "Master B", analysis.viewBId, analysis.noiseB, analysis.weightB );
   console.writeln( format( "Relative scale Sn(B)/Sn(A): %.8f", analysis.relativeScale ) );
   if ( analysis.scaleWarning )
      console.warningln( "Input masters appear to have different linear scales.<br>" +
                         "Consider applying LinearFit before mixing." );
   console.writeln( "Final mixing expression: ", mixingExpression( analysis ) );
   console.flush();
}

function copyMetadataFromMasterA( sourceWindow, outputWindow )
{
   // Assignment of ImageWindow.keywords and regeneration from WCS keywords are
   // both established PJSR patterns. The identical geometry makes the source
   // WCS applicable without reprojection or coordinate adjustment.
   outputWindow.keywords = sourceWindow.keywords;
   if ( sourceWindow.hasAstrometricSolution )
      outputWindow.regenerateAstrometricSolution();
}

function createMix( viewA, viewB, analysis, setStatus )
{
   validateInputs( viewA, viewB );
   if ( analysis == null ||
        viewA.fullId != analysis.viewAId || viewB.fullId != analysis.viewBId )
      throw new Error( "The selected masters have changed. Analyze them again." );

   let expression = mixingExpression( analysis );
   let timer = new ElapsedTime;
   setStatus( "Creating output..." );
   console.writeln( "Creating 32-bit floating-point output..." );
   console.flush();
   let outputWindow = new ImageWindow( viewA.image.width, viewA.image.height,
                                       1, 32, true, false, DEFAULT_OUTPUT_ID );
   let weightedB = null;
   let processStarted = false;
   try
   {
      console.writeln( format( "Applying Master A: %.2f%%...", 100*analysis.weightA ) );
      console.flush();
      outputWindow.mainView.beginProcess( UndoFlag_NoSwapFile |
                                          UndoFlag_Keywords |
                                          UndoFlag_AstrometricSolution );
      processStarted = true;
      outputWindow.mainView.image.assign( viewA.image );
      outputWindow.mainView.image.apply( analysis.weightA, ImageOp_Mul );

      console.writeln( format( "Preparing Master B: %.2f%%...", 100*analysis.weightB ) );
      console.flush();
      weightedB = new Image( viewB.image.width, viewB.image.height, 1,
                             ColorSpace_Gray, 32, SampleType_Real );
      weightedB.assign( viewB.image );
      weightedB.apply( analysis.weightB, ImageOp_Mul );

      console.writeln( "Adding weighted Master B..." );
      console.flush();
      outputWindow.mainView.image.apply( weightedB, ImageOp_Add );

      setStatus( "Copying metadata..." );
      console.writeln( "Copying FITS/WCS metadata..." );
      console.flush();
      copyMetadataFromMasterA( viewA.window, outputWindow );
      outputWindow.mainView.endProcess();
      processStarted = false;

      weightedB.free();
      weightedB = null;
      outputWindow.show();
      console.writeln( "Output view ID: ", outputWindow.mainView.fullId );
      console.writeln( "Final mixing expression: ", expression );
      console.writeln( format( "Mix complete in %.1f s", timer.value ) );
      console.flush();
      return outputWindow;
   }
   catch ( error )
   {
      if ( processStarted )
         outputWindow.mainView.endProcess();
      if ( weightedB != null )
         weightedB.free();
      outputWindow.forceClose();
      throw error;
   }
}

function MasterMixerDialog( model )
{
   this.__base__ = Dialog;
   this.__base__();

   this.windowTitle = TITLE;
   this.userResizable = true;

   this.helpLabel = new Label( this );
   this.helpLabel.frameStyle = FrameStyle_Box;
   this.helpLabel.margin = 6;
   this.helpLabel.wordWrapping = true;
   this.helpLabel.useRichText = true;
   this.helpLabel.text =
      "<b>" + TITLE + "</b><br/>" +
      "Select two registered, linear monochrome masters of the same target and filter. " +
      "Analyze computes scaled inverse-variance weights before any output is created.";

   let labelWidth = this.font.width( "Master B:" ) + 12;

   this.masterALabel = new Label( this );
   this.masterALabel.text = "Master A:";
   this.masterALabel.textAlignment = TextAlign_Right | TextAlign_VertCenter;
   this.masterALabel.setFixedWidth( labelWidth );

   this.masterAViewList = new ViewList( this );
   this.masterAViewList.getMainViews();
   this.masterAViewList.setMinWidth( 36*this.font.width( "M" ) );
   this.masterAViewList.currentView = new View;

   this.masterBLabel = new Label( this );
   this.masterBLabel.text = "Master B:";
   this.masterBLabel.textAlignment = TextAlign_Right | TextAlign_VertCenter;
   this.masterBLabel.setFixedWidth( labelWidth );

   this.masterBViewList = new ViewList( this );
   this.masterBViewList.getMainViews();
   this.masterBViewList.setMinWidth( 36*this.font.width( "M" ) );
   this.masterBViewList.currentView = new View;

   this.resultsTree = new TreeBox( this );
   this.resultsTree.numberOfColumns = 8;
   this.resultsTree.headerVisible = true;
   this.resultsTree.alternateRowColor = true;
   this.resultsTree.rootDecoration = false;
   this.resultsTree.indentSize = 0;
   this.resultsTree.setHeaderText( 0, "Master" );
   this.resultsTree.setHeaderText( 1, "Estimator" );
   this.resultsTree.setHeaderText( 2, "Absolute sigma" );
   this.resultsTree.setHeaderText( 3, "Sn" );
   this.resultsTree.setHeaderText( 4, "Scaled sigma" );
   this.resultsTree.setHeaderText( 5, "Noise pixels %" );
   this.resultsTree.setHeaderText( 6, "MRS layers" );
   this.resultsTree.setHeaderText( 7, "Weight %" );
   let columnExamples = ["Master B: M_123456789012345", "Estimator", "0.000000e+00",
                         "0.000000e+00", "0.000000e+00", "Noise pixels %",
                         "MRS layers", "100.00%"];
   let columnPadding = this.logicalPixelsToPhysical( 24 );
   this.baseMasterColumnWidth = 0;
   this.baseTreeWidth = this.logicalPixelsToPhysical( 8 );
   for ( let column = 0; column < columnExamples.length; ++column )
   {
      let width = this.font.width( columnExamples[column] ) + columnPadding;
      this.resultsTree.setColumnWidth( column, width );
      this.baseTreeWidth += width;
      if ( column == 0 )
         this.baseMasterColumnWidth = width;
   }
   this.resultsTree.setMinWidth( this.baseTreeWidth );
   this.resultsTree.setMinHeight( 4*this.font.lineSpacing +
                                  this.logicalPixelsToPhysical( 12 ) );

   this.scaleDiagnosticLabel = new Label( this );
   this.scaleDiagnosticLabel.useRichText = true;
   this.scaleDiagnosticLabel.wordWrapping = true;
   this.scaleDiagnosticLabel.text = "Relative scale Sn(B)/Sn(A): —";

   this.statusLabel = new Label( this );
   this.statusLabel.text = "Ready";
   this.statusLabel.textAlignment = TextAlign_Left | TextAlign_VertCenter;

   this.setStatus = function( text )
   {
      this.statusLabel.text = text;
      processEvents();
   };

   this.setBusy = function( busy, busyCaption )
   {
      this.masterAViewList.enabled = !busy;
      this.masterBViewList.enabled = !busy;
      this.analyzeButton.enabled = !busy;
      this.createMixButton.enabled = !busy && model.analysis != null;
      this.analyzeButton.text = busy ? busyCaption : "Analyze";
      processEvents();
   };

   this.analyzeButton = new PushButton( this );
   this.analyzeButton.text = "Analyze";
   this.analyzeButton.toolTip = "Estimate noise and calculate normalized weights.";

   this.createMixButton = new PushButton( this );
   this.createMixButton.text = "Create Mix";
   this.createMixButton.enabled = false;
   this.createMixButton.toolTip = "Create a new 32-bit floating-point monochrome image.";

   this.invalidateAnalysis = function()
   {
      model.analysis = null;
      this.resultsTree.clear();
      this.scaleDiagnosticLabel.text = "Relative scale Sn(B)/Sn(A): —";
      this.createMixButton.enabled = false;
   };

   this.masterAViewList.onViewSelected = function( view )
   {
      model.viewA = view;
      this.dialog.invalidateAnalysis();
   };

   this.masterBViewList.onViewSelected = function( view )
   {
      model.viewB = view;
      this.dialog.invalidateAnalysis();
   };

   this.showError = function( error )
   {
      console.criticalln( error.message );
      (new MessageBox( error.message, TITLE, StdIcon_Error, StdButton_Ok )).execute();
   };

   this.populateResults = function( analysis )
   {
      this.resultsTree.clear();
      let entries = [
         ["Master A: " + analysis.viewAId, analysis.noiseA, analysis.weightA],
         ["Master B: " + analysis.viewBId, analysis.noiseB, analysis.weightB]
      ];
      for ( let i = 0; i < entries.length; ++i )
      {
         let node = new TreeBoxNode( this.resultsTree );
         let noise = entries[i][1];
         node.setText( 0, entries[i][0] );
         node.setText( 1, noise.estimator );
         node.setText( 2, format( "%.6e", noise.absoluteSigma ) );
         node.setText( 3, format( "%.6e", noise.signalScale ) );
         node.setText( 4, format( "%.6e", noise.scaledSigma ) );
         node.setText( 5, format( "%.2f%%", noise.noisePercent ) );
         node.setText( 6, noise.layers == null ? "\u2014" : format( "%d", noise.layers ) );
         node.setText( 7, format( "%.2f%%", 100*entries[i][2] ) );
      }
      this.scaleDiagnosticLabel.text =
         "Relative scale Sn(B)/Sn(A): <b>" + format( "%.8f", analysis.relativeScale ) + "</b>";
      if ( analysis.scaleWarning )
         this.scaleDiagnosticLabel.text +=
            "<br><font color='#cc6600'><b>Input masters appear to have different linear scales.<br>" +
            "Consider applying LinearFit before mixing.</b></font>";
   };

   this.analyzeButton.onClick = function()
   {
      let dialog = this.dialog;
      dialog.invalidateAnalysis();
      dialog.setBusy( true, "Analyzing..." );
      try
      {
         console.show();
         console.writeln( "<end><cbr><br><b>[Astrogrm Master Mixer]</b>" );
         console.flush();
         let analysis = analyzeMasters( model.viewA, model.viewB, function( status )
         {
            dialog.setStatus( status );
         } );
         model.analysis = analysis;
         dialog.populateResults( analysis );
         writeAnalysisToConsole( analysis );
         dialog.setStatus( "Done" );
      }
      catch ( error )
      {
         dialog.showError( error );
      }
      finally
      {
         dialog.setBusy( false );
         if ( model.analysis == null )
            dialog.setStatus( "Ready" );
      }
   };

   this.createMixButton.onClick = function()
   {
      let dialog = this.dialog;
      dialog.setBusy( true, "Analyze" );
      try
      {
         createMix( model.viewA, model.viewB, model.analysis, function( status )
         {
            dialog.setStatus( status );
         } );
         dialog.setStatus( "Done" );
      }
      catch ( error )
      {
         dialog.setStatus( "Ready" );
         dialog.showError( error );
      }
      finally
      {
         dialog.setBusy( false );
      }
   };

   this.masterASizer = new HorizontalSizer;
   this.masterASizer.spacing = 6;
   this.masterASizer.add( this.masterALabel );
   this.masterASizer.add( this.masterAViewList, 100 );

   this.masterBSizer = new HorizontalSizer;
   this.masterBSizer.spacing = 6;
   this.masterBSizer.add( this.masterBLabel );
   this.masterBSizer.add( this.masterBViewList, 100 );

   this.buttonSizer = new HorizontalSizer;
   this.buttonSizer.spacing = 8;
   this.buttonSizer.addStretch();
   this.buttonSizer.add( this.analyzeButton );
   this.buttonSizer.add( this.createMixButton );

   this.sizer = new VerticalSizer;
   this.sizer.margin = 8;
   this.sizer.spacing = 8;
   this.sizer.add( this.helpLabel );
   this.sizer.add( this.masterASizer );
   this.sizer.add( this.masterBSizer );
   this.sizer.addSpacing( 4 );
   this.sizer.add( this.resultsTree, 100 );
   this.sizer.add( this.scaleDiagnosticLabel );
   this.sizer.add( this.statusLabel );
   this.sizer.add( this.buttonSizer );

   this.adjustToContents();
   this.initialDialogWidth = this.width;
   this.onResize = function( newWidth, newHeight )
   {
      if ( this.initialDialogWidth > 0 )
         this.resultsTree.setColumnWidth( 0, this.baseMasterColumnWidth +
                                            Math.max( 0, newWidth - this.initialDialogWidth ) );
   };
}

MasterMixerDialog.prototype = new Dialog;

function main()
{
   console.hide();
   let dialog = new MasterMixerDialog( new MasterMixerModel );
   dialog.execute();
}

main();
